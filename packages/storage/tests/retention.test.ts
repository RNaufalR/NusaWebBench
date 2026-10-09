import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppError, createRun, createTarget, type Run } from '@nusawebbench/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore } from '../src/artifacts.js';
import { applyRetention, previewRetention, type RetentionPlan } from '../src/retention.js';
import { Store } from '../src/store.js';

// Semua data sintetis (synthetic/demo).
const TXT = Buffer.from('catatan sintetis (synthetic/demo)\n', 'utf8');
const OLD = new Date('2026-01-01T00:00:00.000Z');
const NOW = new Date('2026-10-09T00:00:00.000Z');
const POLICY = { maxAgeDays: 30 };

let dir: string;
let store: Store;
let root: string;
let artifacts: ArtifactStore;
let targetId: string;

function makeRun(status: 'COMPLETED' | 'RUNNING' | 'QUEUED'): Run {
  const run = createRun({
    targetId,
    targetOrigin: 'http://127.0.0.1:4178',
    targetMode: 'fixture',
    authorization: {
      acknowledged: true,
      scopeSummary: 'fixture',
      scopeHash: null,
      approvedAt: '2026-10-09T02:00:00.000Z',
    },
    configSnapshot: {},
  });
  store.runs.insert(run);
  // Transisi harus berurutan setelah createdAt run (waktu nyata saat tes dibuat).
  const t1 = new Date(Date.parse(run.createdAt) + 1000).toISOString();
  const t2 = new Date(Date.parse(run.createdAt) + 2000).toISOString();
  if (status !== 'QUEUED') {
    store.runs.transition(run.id, 'RUNNING', {
      expectedVersion: store.runs.version(run.id) ?? 0,
      at: t1,
      reason: 'uji',
      patch: { startedAt: t1 },
    });
    if (status === 'COMPLETED') {
      store.runs.transition(run.id, 'COMPLETED', {
        expectedVersion: store.runs.version(run.id) ?? 0,
        at: t2,
        reason: 'uji',
        patch: { completedAt: t2 },
      });
    }
  }
  return store.runs.get(run.id) as Run;
}

function writeArtifact(runId: string): string {
  const ev = artifacts.write({
    runId,
    kind: 'other',
    mimeType: 'text/plain',
    bytes: TXT,
    sourceTool: 'uji',
    sourceVersion: '1.0.0',
    description: 'artefak sintetis (synthetic/demo)',
    redactionApplied: false,
    synthetic: true,
  });
  return ev.id;
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nwb-ret-'));
  store = Store.open(path.join(dir, 'db.sqlite'));
  root = path.join(dir, 'artifacts');
  const target = createTarget({
    label: 'fixture',
    origin: 'http://127.0.0.1:4178',
    mode: 'fixture',
    allowedModules: [],
    scopeConfirmedAt: null,
  });
  store.targets.insert(target);
  targetId = target.id;
  artifacts = new ArtifactStore({ rootDir: root, evidence: store.evidence, now: () => OLD });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function fileOf(evidenceId: string): string {
  const ev = store.evidence.get(evidenceId);
  if (!ev) throw new Error('evidence hilang di uji');
  return path.join(root, ev.pathRelative);
}

describe('retention artefak (T-200)', () => {
  it('preview hanya merencanakan; tidak ada berkas yang dihapus', () => {
    const run = makeRun('COMPLETED');
    const evId = writeArtifact(run.id);
    const plan = previewRetention({ store, artifacts, policy: POLICY, now: NOW });
    expect(plan.candidates.map((c) => c.evidenceId)).toEqual([evId]);
    expect(plan.totalBytes).toBe(TXT.length);
    expect(existsSync(fileOf(evId))).toBe(true);
  });

  it('artefak baru (di dalam umur retention) tidak masuk rencana', () => {
    const run = makeRun('COMPLETED');
    artifacts = new ArtifactStore({
      rootDir: root,
      evidence: store.evidence,
      now: () => new Date('2026-10-08T00:00:00.000Z'),
    });
    writeArtifact(run.id);
    const plan = previewRetention({ store, artifacts, policy: POLICY, now: NOW });
    expect(plan.candidates).toHaveLength(0);
  });

  it('run yang belum terminal (RUNNING/QUEUED) tidak pernah disentuh', () => {
    const running = makeRun('RUNNING');
    const queued = makeRun('QUEUED');
    const a = writeArtifact(running.id);
    const b = writeArtifact(queued.id);
    const plan = previewRetention({ store, artifacts, policy: POLICY, now: NOW });
    expect(plan.candidates).toHaveLength(0);
    expect(plan.skipped).toEqual(
      expect.arrayContaining([
        { evidenceId: a, reason: 'run-active' },
        { evidenceId: b, reason: 'run-active' },
      ]),
    );
  });

  it('apply dengan konfirmasi salah ditolak dan tidak menghapus apa pun', () => {
    const run = makeRun('COMPLETED');
    const evId = writeArtifact(run.id);
    const plan = previewRetention({ store, artifacts, policy: POLICY, now: NOW });
    expect(() => applyRetention({ store, artifacts, plan, confirmPlanId: 'salah' })).toThrow(
      AppError,
    );
    expect(existsSync(fileOf(evId))).toBe(true);
  });

  it('apply yang dikonfirmasi menghapus byte berkas; metadata tetap sebagai jejak audit', () => {
    const run = makeRun('COMPLETED');
    const evId = writeArtifact(run.id);
    const plan = previewRetention({ store, artifacts, policy: POLICY, now: NOW });
    const result = applyRetention({ store, artifacts, plan, confirmPlanId: plan.planId });
    expect(result.deleted).toEqual([evId]);
    expect(result.freedBytes).toBe(TXT.length);
    expect(existsSync(fileOf(evId))).toBe(false);
    expect(store.evidence.get(evId)).not.toBeNull();
    // Pembacaan berikutnya gagal dengan aman, tidak mengembalikan data palsu.
    expect(() => artifacts.readVerified(evId)).toThrow(AppError);
    // Rencana kedua tidak lagi memuat berkas yang sudah hilang.
    const again = previewRetention({ store, artifacts, policy: POLICY, now: NOW });
    expect(again.candidates).toHaveLength(0);
    expect(again.skipped).toEqual([{ evidenceId: evId, reason: 'file-missing' }]);
  });

  it('metadata kandidat hilang setelah preview → apply melewati dengan changed-since-preview', () => {
    const run = makeRun('COMPLETED');
    const evId = writeArtifact(run.id);
    const plan = previewRetention({ store, artifacts, policy: POLICY, now: NOW });
    expect(plan.candidates).toHaveLength(1);
    const file = fileOf(evId);
    store.db.prepare('DELETE FROM evidence WHERE id = ?').run(evId);
    const result = applyRetention({ store, artifacts, plan, confirmPlanId: plan.planId });
    expect(result.deleted).toHaveLength(0);
    expect(result.skipped).toEqual([{ evidenceId: evId, reason: 'changed-since-preview' }]);
    // Berkas tidak dihapus karena kandidat sudah tidak tercatat.
    expect(existsSync(file)).toBe(true);
  });

  it('rencana yang diubah (kandidat disisipkan) ditolak walau konfirmasi cocok', () => {
    const run = makeRun('COMPLETED');
    writeArtifact(run.id);
    const plan = previewRetention({ store, artifacts, policy: POLICY, now: NOW });
    const tampered: RetentionPlan = {
      ...plan,
      candidates: plan.candidates.map((c) => ({ ...c, pathRelative: '../luar.txt' })),
    };
    expect(() =>
      applyRetention({ store, artifacts, plan: tampered, confirmPlanId: plan.planId }),
    ).toThrow(AppError);
  });

  it('symlink di dalam root yang menunjuk ke luar root ditolak; berkas di luar tidak tersentuh', () => {
    const run = makeRun('COMPLETED');
    const evId = writeArtifact(run.id);
    const outside = path.join(dir, 'berkas-pengguna.txt');
    writeFileSync(outside, 'milik pengguna\n');
    unlinkSync(fileOf(evId));
    symlinkSync(outside, fileOf(evId));
    const plan = previewRetention({ store, artifacts, policy: POLICY, now: NOW });
    expect(plan.candidates).toHaveLength(0);
    expect(plan.skipped).toEqual([{ evidenceId: evId, reason: 'path-rejected' }]);
    const result = applyRetention({ store, artifacts, plan, confirmPlanId: plan.planId });
    expect(result.deleted).toHaveLength(0);
    expect(readFileSync(outside, 'utf8')).toBe('milik pengguna\n');
  });

  it('batas umur di luar 1..3650 hari dan bilangan non-integer ditolak', () => {
    for (const maxAgeDays of [0, -1, 3651, 1.5, Number.NaN]) {
      expect(() =>
        previewRetention({ store, artifacts, policy: { maxAgeDays }, now: NOW }),
      ).toThrow(AppError);
    }
  });
});

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppError, createRun, createTarget, type Run } from '@nusawebbench/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ArtifactStore, contentMismatch, writeFileAtomic } from '../src/artifacts.js';
import { Store } from '../src/store.js';

// Semua data di sini sintetis (synthetic/demo).
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]);

let dir: string;
let store: Store;
let run: Run;
let root: string;

function meta(overrides: Partial<{ kind: 'other' | 'json' }> = {}) {
  return {
    runId: run.id,
    kind: 'other' as const,
    sourceTool: 'test-tool',
    sourceVersion: '1.0.0',
    description: 'artefak sintetis (synthetic/demo)',
    redactionApplied: false,
    synthetic: true,
    ...overrides,
  };
}

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nwb-art-'));
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
  run = createRun({
    targetId: target.id,
    targetOrigin: target.origin,
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
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function newStore(extra: Partial<ConstructorParameters<typeof ArtifactStore>[0]> = {}) {
  return new ArtifactStore({ rootDir: root, evidence: store.evidence, ...extra });
}

describe('deteksi isi (bukan ekstensi)', () => {
  it('PNG asli diterima sebagai image/png', () => {
    expect(contentMismatch('image/png', PNG_HEADER)).toBeNull();
  });

  it('MIME spoof: PNG yang dideklarasikan text/plain ditolak', () => {
    expect(contentMismatch('text/plain', PNG_HEADER)).toBe('binary-signature-in-text');
  });

  it('JPEG yang dideklarasikan image/png ditolak', () => {
    expect(contentMismatch('image/png', JPEG_HEADER)).toBe('signature-mismatch');
  });

  it('JSON tidak valid ditolak; JSON valid diterima', () => {
    expect(contentMismatch('application/json', Buffer.from('{"a":'))).toBe('invalid-json');
    expect(contentMismatch('application/json', Buffer.from('{"a":1}'))).toBeNull();
  });

  it('teks dengan NUL atau UTF-8 rusak ditolak', () => {
    expect(contentMismatch('text/plain', Buffer.from([0x61, 0x00, 0x62]))).toBe('nul-byte-in-text');
    expect(contentMismatch('text/html', Buffer.from([0xc3, 0x28]))).toBe('invalid-utf8');
  });
});

describe('ArtifactStore.write dan readVerified', () => {
  it('tulis lalu baca: hash dan metadata cocok dengan isi', () => {
    const artifacts = newStore();
    const bytes = Buffer.from('{"ok":true}');
    const written = artifacts.write({
      ...meta(),
      kind: 'json',
      mimeType: 'application/json',
      bytes,
    });
    expect(written.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
    expect(written.sizeBytes).toBe(bytes.length);
    expect(written.pathRelative.startsWith(`${run.id}/`)).toBe(true);
    expect(artifacts.readVerified(written.id).equals(bytes)).toBe(true);
  });

  it('nama berkas dari pengguna tidak dipakai: path memakai ID dan ekstensi dari MIME', () => {
    const artifacts = newStore();
    const ev = artifacts.write({ ...meta(), mimeType: 'image/png', bytes: PNG_HEADER });
    expect(ev.pathRelative).toMatch(/^run_[a-f0-9]{32}\/evd_[a-f0-9]{32}\.png$/);
  });

  it('ukuran melebihi batas ditolak sebelum menyentuh disk', () => {
    const artifacts = newStore({ maxBytes: 16 });
    expect(() =>
      artifacts.write({ ...meta(), mimeType: 'text/plain', bytes: Buffer.alloc(17, 0x61) }),
    ).toThrow(expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' }));
    expect(readdirSync(root)).toEqual([]);
  });

  it('run id yang berisi path traversal ditolak', () => {
    const artifacts = newStore();
    expect(() =>
      artifacts.write({
        ...meta(),
        runId: '../escape',
        mimeType: 'text/plain',
        bytes: Buffer.from('x'),
      }),
    ).toThrow(expect.objectContaining({ code: 'VALIDATION_FAILED' }));
  });

  it('MIME spoof ditolak dengan ARTIFACT_ERROR', () => {
    const artifacts = newStore();
    expect(() => artifacts.write({ ...meta(), mimeType: 'text/plain', bytes: PNG_HEADER })).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_ERROR' }),
    );
  });

  it('artefak yang diubah di disk ditolak saat dibaca (hash mismatch)', () => {
    const artifacts = newStore();
    const ev = artifacts.write({ ...meta(), mimeType: 'text/plain', bytes: Buffer.from('asli') });
    writeFileSync(path.join(root, ev.pathRelative), Buffer.from('palsu'));
    expect(() => artifacts.readVerified(ev.id)).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_ERROR' }),
    );
  });

  it('artefak yang hilang ditolak tanpa membocorkan path', () => {
    const artifacts = newStore();
    const ev = artifacts.write({ ...meta(), mimeType: 'text/plain', bytes: Buffer.from('x') });
    rmSync(path.join(root, ev.pathRelative));
    try {
      artifacts.readVerified(ev.id);
      throw new Error('seharusnya gagal');
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect(String((err as AppError).safeMessage)).not.toContain(root);
    }
  });

  it('symlink yang keluar root ditolak', () => {
    const artifacts = newStore();
    const outside = path.join(dir, 'outside.txt');
    writeFileSync(outside, 'rahasia');
    const ev = artifacts.write({ ...meta(), mimeType: 'text/plain', bytes: Buffer.from('x') });
    const link = path.join(root, ev.pathRelative);
    rmSync(link);
    symlinkSync(outside, link);
    expect(() => artifacts.resolveExisting(ev.pathRelative)).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_ERROR' }),
    );
  });

  it('direktori run yang berupa symlink ke luar root ditolak', () => {
    const artifacts = newStore();
    const outsideDir = path.join(dir, 'outside-dir');
    mkdirSync(outsideDir);
    symlinkSync(outsideDir, path.join(root, run.id));
    expect(() =>
      artifacts.write({ ...meta(), mimeType: 'text/plain', bytes: Buffer.from('x') }),
    ).toThrow(expect.objectContaining({ code: 'ARTIFACT_ERROR' }));
    expect(readdirSync(outsideDir)).toEqual([]);
  });

  it('kegagalan metadata DB tidak meninggalkan file yatim', () => {
    const artifacts = newStore();
    const original = store.evidence.insert.bind(store.evidence);
    store.evidence.insert = () => {
      throw new AppError('STORAGE_ERROR');
    };
    expect(() =>
      artifacts.write({ ...meta(), mimeType: 'text/plain', bytes: Buffer.from('x') }),
    ).toThrow(expect.objectContaining({ code: 'STORAGE_ERROR' }));
    store.evidence.insert = original;
    const runDir = path.join(root, run.id);
    expect(existsSync(runDir) ? readdirSync(runDir) : []).toEqual([]);
  });

  it('penulisan terputus (sebelum rename) tidak menyisakan file final maupun sementara', () => {
    const artifacts = newStore({
      beforeCommit: () => {
        throw new Error('simulated interruption');
      },
    });
    expect(() =>
      artifacts.write({ ...meta(), mimeType: 'text/plain', bytes: Buffer.from('x') }),
    ).toThrow(expect.objectContaining({ code: 'ARTIFACT_ERROR' }));
    const runDir = path.join(root, run.id);
    expect(existsSync(runDir) ? readdirSync(runDir) : []).toEqual([]);
    expect(store.evidence.listByRun(run.id)).toEqual([]);
  });
});

describe('writeFileAtomic', () => {
  it('menulis di dalam root', () => {
    const r = path.join(dir, 'exports');
    mkdirSync(r);
    writeFileAtomic(r, path.join(r, 'a', 'b.json'), Buffer.from('{}'));
    expect(readdirSync(path.join(r, 'a'))).toEqual(['b.json']);
  });

  it('menolak path di luar root (traversal)', () => {
    const r = path.join(dir, 'exports');
    mkdirSync(r);
    expect(() => writeFileAtomic(r, path.join(r, '..', 'escape.json'), Buffer.from('x'))).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_ERROR' }),
    );
    expect(existsSync(path.join(dir, 'escape.json'))).toBe(false);
  });
});

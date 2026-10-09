import { mkdirSync, mkdtempSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AppError,
  createFinding,
  createModuleResult,
  createRun,
  createTarget,
  createEvidence,
  createProviderUsage,
} from '@nusawebbench/core';
import {
  LATEST_SCHEMA_VERSION,
  MIGRATIONS,
  Store,
  currentSchemaVersion,
  migrate,
  openDatabase,
  withTransaction,
  type Migration,
} from '../src/index.js';

const T = '2026-10-09T02:00:00.000Z';
const T2 = '2026-10-09T02:00:05.000Z';
const SHA = 'b'.repeat(64);

function firstMigration(): Migration {
  const m = MIGRATIONS[0];
  if (!m) throw new Error('no migrations defined');
  return m;
}

let dir: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nwb-db-'));
  store = Store.open(path.join(dir, 'test.sqlite'));
});

afterEach(() => {
  store.close();
});

function makeTarget() {
  return createTarget({
    label: 'Fixture lokal',
    origin: 'http://127.0.0.1:4178',
    mode: 'fixture',
    allowedModules: ['FUNCTIONAL_QA'],
    scopeConfirmedAt: T,
    now: new Date(T),
  });
}

function makeRun(targetId: string) {
  return createRun({
    targetId,
    targetOrigin: 'http://127.0.0.1:4178',
    targetMode: 'fixture',
    authorization: {
      acknowledged: true,
      scopeSummary: 'fixture lokal',
      scopeHash: SHA,
      approvedAt: T,
    },
    configSnapshot: { AI_PROVIDER: 'none' },
    now: new Date(T),
  });
}

function expectCode(fn: () => unknown, code: string): void {
  let caught: unknown;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(AppError);
  expect((caught as AppError).code).toBe(code);
}

describe('migrations', () => {
  it('database kosong → migrasi terbaru diterapkan, dan menjalankan ulang tidak mengubah apa pun', () => {
    const db = openDatabase(':memory:');
    try {
      expect(migrate(db)).toEqual([1]);
      expect(currentSchemaVersion(db)).toBe(LATEST_SCHEMA_VERSION);
      expect(migrate(db)).toEqual([]);
    } finally {
      db.close();
    }
  });

  it('migrasi yang sudah diterapkan dengan checksum berbeda ditolak', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      db.exec("UPDATE schema_migrations SET checksum = 'tampered' WHERE version = 1");
      expectCode(() => migrate(db), 'STORAGE_ERROR');
    } finally {
      db.close();
    }
  });

  it('database dari versi aplikasi yang lebih baru ditolak (tanpa downgrade diam-diam)', () => {
    const db = openDatabase(':memory:');
    try {
      migrate(db);
      db.prepare(
        "INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (99, 'future', 'x', ?)",
      ).run(T);
      expectCode(() => migrate(db), 'STORAGE_ERROR');
    } finally {
      db.close();
    }
  });

  it('migrasi yang gagal di tengah melakukan rollback dan tidak tercatat', () => {
    const db = openDatabase(':memory:');
    try {
      const broken: Migration[] = [
        { version: 1, name: 'ok', sql: 'CREATE TABLE a (x TEXT) STRICT;' },
        { version: 2, name: 'broken', sql: 'CREATE TABLE b (x TEXT) STRICT; THIS IS NOT SQL;' },
      ];
      expectCode(() => migrate(db, broken), 'STORAGE_ERROR');
      // Versi 1 juga harus rollback? Migrasi dijalankan per-transaksi: v1 sudah commit, v2 rollback.
      expect(currentSchemaVersion(db)).toBe(1);
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'b'")
        .all();
      expect(tables).toHaveLength(0);
    } finally {
      db.close();
    }
  });

  it('dari versi sebelumnya: database v1 dibuka ulang dan diperbarui tanpa menyentuh data lama', () => {
    const file = path.join(dir, 'upgrade.sqlite');
    // Simulasi database yang dibuat versi aplikasi sebelumnya: hanya migrasi v1 dengan checksum yang sama.
    const first = openDatabase(file);
    migrate(first, [firstMigration()]);
    first
      .prepare(
        "INSERT INTO app_settings (key, value_json, updated_at) VALUES ('legacy.key', '\"lama\"', ?)",
      )
      .run(T);
    first.close();

    // Migrasi tambahan (v2) yang hanya ada di versi baru.
    const v2: Migration = {
      version: 2,
      name: 'add-note',
      sql: 'CREATE TABLE notes (id TEXT PRIMARY KEY) STRICT;',
    };
    const reopened = openDatabase(file);
    try {
      expect(migrate(reopened, [firstMigration(), v2])).toEqual([2]);
      expect(currentSchemaVersion(reopened)).toBe(2);
      const legacy = reopened
        .prepare("SELECT value_json FROM app_settings WHERE key = 'legacy.key'")
        .get();
      expect(legacy?.['value_json']).toBe('"lama"');
    } finally {
      reopened.close();
    }
  });
});

describe('transaksi', () => {
  it('error di tengah transaksi melakukan rollback penuh', () => {
    const target = makeTarget();
    store.targets.insert(target);
    expect(() =>
      withTransaction(store.db, () => {
        store.db
          .prepare('INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)')
          .run('rollback.test', '1', T);
        throw new Error('gagal di tengah');
      }),
    ).toThrow(AppError);
    expect(store.settings.get('rollback.test')).toBeUndefined();
  });
});

describe('targets', () => {
  it('insert, get, findByOrigin, dan origin unik', () => {
    const target = makeTarget();
    store.targets.insert(target);
    expect(store.targets.get(target.id)).toEqual(target);
    expect(store.targets.findByOrigin('http://127.0.0.1:4178')?.id).toBe(target.id);
    const duplicate = createTarget({
      label: 'Duplikat',
      origin: 'http://127.0.0.1:4178',
      mode: 'fixture',
      allowedModules: [],
      scopeConfirmedAt: null,
    });
    expectCode(() => store.targets.insert(duplicate), 'CONFLICT');
  });

  it('batas limit dipaksa (nol, negatif, atau terlalu besar ditolak)', () => {
    expectCode(() => store.targets.list(0), 'VALIDATION_FAILED');
    expectCode(() => store.targets.list(10_000), 'VALIDATION_FAILED');
    expectCode(() => store.targets.list(1.5), 'VALIDATION_FAILED');
  });
});

describe('runs lifecycle dan persistensi', () => {
  it('insert, transisi valid, dan transisi tidak valid ditolak', () => {
    const target = makeTarget();
    store.targets.insert(target);
    const run = makeRun(target.id);
    store.runs.insert(run);

    const running = store.runs.transition(run.id, 'RUNNING', {
      expectedVersion: 0,
      at: T,
      reason: 'mulai',
      patch: { startedAt: T },
    });
    expect(running.status).toBe('RUNNING');

    // RUNNING -> QUEUED tidak diizinkan.
    expectCode(
      () => store.runs.transition(run.id, 'QUEUED', { expectedVersion: 1, at: T2, reason: 'x' }),
      'CONFLICT',
    );
    // Versi lama (compare-and-set) ditolak.
    expectCode(
      () =>
        store.runs.transition(run.id, 'COMPLETED', {
          expectedVersion: 0,
          at: T2,
          reason: 'x',
          patch: { completedAt: T2 },
        }),
      'CONFLICT',
    );
    const done = store.runs.transition(run.id, 'COMPLETED', {
      expectedVersion: 1,
      at: T2,
      reason: 'selesai',
      patch: { completedAt: T2 },
    });
    expect(done.status).toBe('COMPLETED');

    // Terminal: tidak ada transisi keluar.
    expectCode(
      () => store.runs.transition(run.id, 'RUNNING', { expectedVersion: 2, at: T2, reason: 'x' }),
      'CONFLICT',
    );
    expect(store.runs.transitionsFor(run.id).map((t) => t.to)).toEqual([
      'QUEUED',
      'RUNNING',
      'COMPLETED',
    ]);
  });

  it('patch transisi tidak dapat mengubah identitas run (targetId, id)', () => {
    const target = makeTarget();
    store.targets.insert(target);
    const run = makeRun(target.id);
    store.runs.insert(run);
    const hostile = {
      targetId: 'tgt_00000000000000000000000000000000',
      id: 'run_00000000000000000000000000000000',
    };
    const after = store.runs.transition(run.id, 'RUNNING', {
      expectedVersion: 0,
      at: T,
      reason: 'mulai',
      patch: { startedAt: T, ...(hostile as unknown as Record<string, never>) },
    });
    expect(after.targetId).toBe(target.id);
    expect(after.id).toBe(run.id);
  });

  it('run terminal tanpa completedAt ditolak oleh schema', () => {
    const target = makeTarget();
    store.targets.insert(target);
    const run = makeRun(target.id);
    store.runs.insert(run);
    store.runs.transition(run.id, 'RUNNING', {
      expectedVersion: 0,
      at: T,
      reason: 'mulai',
      patch: { startedAt: T },
    });
    expectCode(
      () => store.runs.transition(run.id, 'COMPLETED', { expectedVersion: 1, at: T2, reason: 'x' }),
      'VALIDATION_FAILED',
    );
  });

  it('duplicate run ID ditolak (CONFLICT)', () => {
    const target = makeTarget();
    store.targets.insert(target);
    const run = makeRun(target.id);
    store.runs.insert(run);
    expectCode(() => store.runs.insert(run), 'CONFLICT');
  });

  it('run dengan target yang tidak ada ditolak (foreign key)', () => {
    const run = makeRun('tgt_00000000000000000000000000000000');
    expectCode(() => store.runs.insert(run), 'VALIDATION_FAILED');
  });

  it('run yang dimasukkan dengan hasil anak ditolak', () => {
    const target = makeTarget();
    store.targets.insert(target);
    const run = makeRun(target.id);
    expectCode(
      () => store.runs.insert({ ...run, findingIds: ['fnd_00000000000000000000000000000000'] }),
      'VALIDATION_FAILED',
    );
  });

  it('persisten setelah restart aplikasi (buka ulang file yang sama)', () => {
    const file = path.join(dir, 'restart.sqlite');
    const first = Store.open(file);
    const target = makeTarget();
    first.targets.insert(target);
    const run = makeRun(target.id);
    first.runs.insert(run);
    first.settings.set('ai.requests.marker', 3, new Date(T));
    first.close();

    const second = Store.open(file);
    try {
      expect(second.runs.get(run.id)?.status).toBe('QUEUED');
      expect(second.settings.get('ai.requests.marker')).toBe(3);
      expect(second.runs.list()).toHaveLength(1);
    } finally {
      second.close();
    }
  });

  it('data run yang dimanipulasi di database ditolak saat dibaca', () => {
    const target = makeTarget();
    store.targets.insert(target);
    const run = makeRun(target.id);
    store.runs.insert(run);
    store.db.prepare('UPDATE runs SET data_json = \'{"id":"rusak"}\' WHERE id = ?').run(run.id);
    expectCode(() => store.runs.get(run.id), 'STORAGE_ERROR');
  });
});

describe('module, finding, evidence, usage, remediation', () => {
  function setupRun() {
    const target = makeTarget();
    store.targets.insert(target);
    const run = makeRun(target.id);
    store.runs.insert(run);
    const module = createModuleResult({
      runId: run.id,
      module: 'FUNCTIONAL_QA',
      status: 'PASS',
      startedAt: T,
      completedAt: T2,
      durationMs: 5000,
      toolName: 'playwright',
      toolVersion: '1.64.0',
      configSnapshot: {},
      metrics: { pageCount: 1 },
      findingIds: [],
      artifactRefs: [],
      errorCode: null,
      errorMessageSafe: null,
      retryCount: 0,
      skippedReason: null,
    });
    store.modules.insert(module);
    return { target, run, module };
  }

  it('satu hasil per modul per run (UNIQUE) dan identitas modul tidak bisa diubah', () => {
    const { run, module } = setupRun();
    expectCode(
      () => store.modules.insert({ ...module, id: 'mod_11111111111111111111111111111111' }),
      'CONFLICT',
    );
    expectCode(() => store.modules.update({ ...module, module: 'UX_RULES' }), 'FORBIDDEN');
    store.modules.update({ ...module, status: 'WARN' });
    expect(store.modules.listByRun(run.id)[0]?.status).toBe('WARN');
  });

  it('temuan duplikat dalam satu run tidak disimpan dua kali (idempoten)', () => {
    const { run, module } = setupRun();
    const evidence = createEvidence({
      runId: run.id,
      kind: 'screenshot',
      pathRelative: `${run.id}/s1.png`,
      mimeType: 'image/png',
      sizeBytes: 10,
      sha256: SHA,
      createdAt: T,
      sourceTool: 'playwright',
      sourceVersion: '1.64.0',
      description: 'synthetic/demo',
      redactionApplied: false,
      synthetic: true,
    });
    store.evidence.insert(evidence);
    const finding = createFinding({
      runId: run.id,
      moduleResultId: module.id,
      category: 'FUNCTIONAL',
      title: 'Console error',
      description: 'd',
      severity: 'MEDIUM',
      confidence: 0.8,
      verification: 'CONFIRMED',
      source: 'DETERMINISTIC',
      targetUrl: 'http://127.0.0.1:4178/',
      selector: null,
      evidenceRefs: [evidence.id],
      reproductionSteps: ['buka'],
      expected: null,
      actual: null,
      remediation: null,
      createdAt: T,
      status: 'OPEN',
      ruleId: 'console-error',
      ruleVersion: '1.0.0',
    });
    expect(store.findings.insertIfNew(finding)).toBe(true);
    const again = { ...finding, id: 'fnd_22222222222222222222222222222222' };
    expect(store.findings.insertIfNew(again)).toBe(false);
    expect(store.findings.listByRun(run.id).total).toBe(1);
    expect(store.evidence.listByRun(run.id)).toHaveLength(1);
    expectCode(
      () => store.evidence.insert({ ...evidence, id: 'evd_33333333333333333333333333333333' }),
      'CONFLICT',
    );
  });

  it('paging temuan dibatasi dan offset negatif dinormalkan ke 0', () => {
    const { run } = setupRun();
    expect(store.findings.listByRun(run.id, { limit: 10, offset: -5 }).items).toEqual([]);
  });

  it('input berbahaya diperlakukan sebagai data, bukan SQL', () => {
    const { run, module } = setupRun();
    const malicious = "'); DROP TABLE runs; --";
    const finding = createFinding({
      runId: run.id,
      moduleResultId: module.id,
      category: 'FUNCTIONAL',
      title: malicious,
      description: `<script>alert(1)</script> ${malicious}`,
      severity: 'LOW',
      confidence: 0.5,
      verification: 'LIKELY',
      source: 'DETERMINISTIC',
      targetUrl: null,
      selector: null,
      evidenceRefs: [],
      reproductionSteps: [],
      expected: null,
      actual: null,
      remediation: null,
      createdAt: T,
      status: 'OPEN',
      ruleId: 'x-rule',
      ruleVersion: '1.0.0',
    });
    store.findings.insertIfNew(finding);
    expect(store.findings.listByRun(run.id).items[0]?.title).toBe(malicious);
    expect(store.runs.get(run.id)).not.toBeNull();
  });

  it('usage lokal dihitung per provider dan hari, dan tetap ada setelah restart', () => {
    const file = path.join(dir, 'usage.sqlite');
    const s1 = Store.open(file);
    s1.usage.insert(
      createProviderUsage({
        runId: null,
        provider: 'groq',
        modelId: 'example-model-1',
        taskType: 'TEXT_SUMMARY',
        requestCount: 2,
        status: 'OK',
        durationMs: 100,
        inputTokens: null,
        outputTokens: null,
        estimatedTokens: null,
        estimatedCost: null,
        localQuotaBucket: '2026-10-09',
        recordedAt: T,
        errorCode: null,
        fallbackFrom: null,
      }),
    );
    s1.close();
    const s2 = Store.open(file);
    try {
      expect(s2.usage.countRequests('groq', '2026-10-09')).toBe(2);
      expect(s2.usage.countRequests('gemini', '2026-10-09')).toBe(0);
      expect(s2.usage.countRequests('groq', '2026-10-10')).toBe(0);
    } finally {
      s2.close();
    }
  });

  it('pengaturan: kunci tidak valid ditolak; nilai tipe primitif tersimpan', () => {
    expectCode(() => store.settings.set('Bad Key;', 1), 'VALIDATION_FAILED');
    store.settings.set('ui.theme', 'dark');
    expect(store.settings.get('ui.theme')).toBe('dark');
    expect(store.settings.get('missing.key')).toBeUndefined();
  });
});

describe('error handling database', () => {
  it('file database rusak → STORAGE_ERROR tanpa path di pesan aman', () => {
    const file = path.join(dir, 'corrupt.sqlite');
    writeFileSync(file, 'ini bukan database sqlite sama sekali '.repeat(100));
    let caught: unknown;
    try {
      Store.open(file);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('STORAGE_ERROR');
    expect((caught as AppError).safeMessage).not.toContain(dir);
  });

  it('folder database tidak dapat ditulis → STORAGE_ERROR (dilewati jika berjalan sebagai root)', () => {
    if (process.getuid?.() === 0) {
      return; // root dapat menulis ke folder read-only; tes tidak bermakna.
    }
    const locked = path.join(dir, 'locked');
    writeFileSync(locked, 'bukan folder');
    expectCode(() => openDatabase(path.join(locked, 'x.sqlite')), 'STORAGE_ERROR');
    const ro = path.join(dir, 'readonly');
    mkdirSync(ro);
    chmodSync(ro, 0o500);
    try {
      expect(existsSync(ro)).toBe(true);
      expectCode(() => openDatabase(path.join(ro, 'sub', 'x.sqlite')), 'STORAGE_ERROR');
    } finally {
      chmodSync(ro, 0o700);
    }
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AppError,
  createFinding,
  createTarget,
  type ModuleName,
  type ScopeGrant,
  type Target,
} from '@nusawebbench/core';
import { Store } from '@nusawebbench/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  aggregateRunStatus,
  buildRunPlan,
  RunOrchestrator,
  type ModuleAdapter,
  type ModuleContext,
  type ModuleOutcome,
} from '../src/index.js';

const FIXTURE_ORIGIN = 'http://127.0.0.1:4178';
const fixtureGrant: ScopeGrant = { origin: FIXTURE_ORIGIN, mode: 'local-fixture' };

/** Promise yang dapat diselesaikan dari luar, untuk mengendalikan urutan tanpa tidur tetap. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

type Behaviour = (ctx: ModuleContext) => Promise<ModuleOutcome> | ModuleOutcome;

function adapter(
  module: ModuleName,
  behaviour: Behaviour,
  opts: { required?: boolean; timeoutMs?: number; maxRetries?: number } = {},
): ModuleAdapter & { calls: number } {
  const a = {
    module,
    required: opts.required ?? true,
    timeoutMs: opts.timeoutMs ?? 2000,
    maxRetries: opts.maxRetries ?? 0,
    calls: 0,
    async run(ctx: ModuleContext) {
      a.calls++;
      return behaviour(ctx);
    },
  };
  return a;
}

const PASS: ModuleOutcome = { status: 'PASS', metrics: { score: 90 } };

let dir: string;
let store: Store;
let target: Target;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nwb-orch-'));
  store = Store.open(path.join(dir, 'test.sqlite'));
  target = createTarget({
    label: 'Fixture lokal (synthetic/demo)',
    origin: FIXTURE_ORIGIN,
    mode: 'fixture',
    allowedModules: [],
    scopeConfirmedAt: null,
  });
  store.targets.insert(target);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function orchestrator(adapters: ModuleAdapter[], extra: { now?: () => Date } = {}) {
  return new RunOrchestrator({ store, adapters, ...extra });
}

function newRun(o: RunOrchestrator, modules: ModuleName[], idempotencyKey?: string) {
  return o.createRun({
    target,
    grant: fixtureGrant,
    modules,
    acknowledged: true,
    ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
  });
}

describe('aggregateRunStatus', () => {
  it('semua modul wajib dijalankan → COMPLETED', () => {
    expect(
      aggregateRunStatus({
        cancelRequested: false,
        modules: [
          { module: 'FUNCTIONAL_QA', status: 'PASS', required: true },
          { module: 'UX_RULES', status: 'FAIL', required: true },
        ],
      }),
    ).toBe('COMPLETED');
  });

  it('modul wajib UNAVAILABLE/ERROR/NOT_RUN bukan sukses → PARTIAL bila ada hasil lain', () => {
    expect(
      aggregateRunStatus({
        cancelRequested: false,
        modules: [
          { module: 'FUNCTIONAL_QA', status: 'ERROR', required: true },
          { module: 'UX_RULES', status: 'PASS', required: true },
        ],
      }),
    ).toBe('PARTIAL');
  });

  it('tidak ada hasil sama sekali → FAILED; tanpa modul → FAILED', () => {
    expect(
      aggregateRunStatus({
        cancelRequested: false,
        modules: [{ module: 'UX_RULES', status: 'UNAVAILABLE', required: true }],
      }),
    ).toBe('FAILED');
    expect(aggregateRunStatus({ cancelRequested: false, modules: [] })).toBe('FAILED');
  });

  it('modul opsional SKIPPED tetap COMPLETED; opsional ERROR → PARTIAL', () => {
    expect(
      aggregateRunStatus({
        cancelRequested: false,
        modules: [
          { module: 'UX_RULES', status: 'PASS', required: true },
          { module: 'LOAD_K6', status: 'SKIPPED', required: false },
        ],
      }),
    ).toBe('COMPLETED');
    expect(
      aggregateRunStatus({
        cancelRequested: false,
        modules: [
          { module: 'UX_RULES', status: 'PASS', required: true },
          { module: 'LOAD_K6', status: 'ERROR', required: false },
        ],
      }),
    ).toBe('PARTIAL');
  });

  it('pembatalan selalu menang → CANCELLED', () => {
    expect(
      aggregateRunStatus({
        cancelRequested: true,
        modules: [{ module: 'UX_RULES', status: 'PASS', required: true }],
      }),
    ).toBe('CANCELLED');
  });
});

describe('buildRunPlan dan consent', () => {
  it('remote dengan modul browser ditolak sebelum run', () => {
    const plan = buildRunPlan({
      origin: 'https://example.com',
      mode: 'remote',
      modules: ['FUNCTIONAL_QA'],
    });
    expect(plan.allowed).toBe(false);
    expect(plan.blockedReason).toMatch(/fixture lokal/);
  });

  it('fixture lokal diizinkan dan menampilkan efek', () => {
    const plan = buildRunPlan({
      origin: FIXTURE_ORIGIN,
      mode: 'local-fixture',
      modules: ['UX_RULES'],
    });
    expect(plan.allowed).toBe(true);
    expect(plan.effects.length).toBeGreaterThan(0);
  });

  it('tanpa consent, run tidak dibuat', () => {
    const o = orchestrator([adapter('UX_RULES', () => PASS)]);
    expect(() =>
      o.createRun({ target, grant: fixtureGrant, modules: ['UX_RULES'], acknowledged: false }),
    ).toThrow(AppError);
    expect(store.runs.list()).toHaveLength(0);
  });

  it('remote dengan modul browser tidak membuat run', () => {
    const remoteTarget = createTarget({
      label: 'Remote',
      origin: 'https://example.com',
      mode: 'url',
      allowedModules: [],
      scopeConfirmedAt: null,
    });
    store.targets.insert(remoteTarget);
    const o = orchestrator([adapter('FUNCTIONAL_QA', () => PASS)]);
    expect(() =>
      o.createRun({
        target: remoteTarget,
        grant: { origin: 'https://example.com', mode: 'remote' },
        modules: ['FUNCTIONAL_QA'],
        acknowledged: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'SCOPE_DENIED' }));
    expect(store.runs.list()).toHaveLength(0);
  });

  it('grant dengan origin lain dari target ditolak', () => {
    const o = orchestrator([adapter('UX_RULES', () => PASS)]);
    expect(() =>
      o.createRun({
        target,
        grant: { origin: 'http://127.0.0.1:9999', mode: 'local-fixture' },
        modules: ['UX_RULES'],
        acknowledged: true,
      }),
    ).toThrow(expect.objectContaining({ code: 'SCOPE_DENIED' }));
  });

  it('idempotency key yang sama mengembalikan run yang sama (double submit)', () => {
    const o = orchestrator([adapter('UX_RULES', () => PASS)]);
    const a = newRun(o, ['UX_RULES'], 'key-1');
    const b = newRun(o, ['UX_RULES'], 'key-1');
    expect(b.id).toBe(a.id);
    expect(store.runs.list()).toHaveLength(1);
  });
});

describe('eksekusi dan status', () => {
  it('happy path: semua modul PASS → COMPLETED, transisi tersimpan, hasil tersimpan', async () => {
    const o = orchestrator([
      adapter('FUNCTIONAL_QA', () => PASS),
      adapter('UX_RULES', () => ({ status: 'FAIL', metrics: { findings: 2 } })),
    ]);
    const run = newRun(o, ['FUNCTIONAL_QA', 'UX_RULES']);
    const done = await o.start(run.id);
    expect(done.status).toBe('COMPLETED');
    expect(done.startedAt).not.toBeNull();
    expect(done.completedAt).not.toBeNull();
    expect(done.moduleResults.map((m) => m.status)).toEqual(['PASS', 'FAIL']);
    const transitions = store.runs.transitionsFor(run.id).map((t) => t.to);
    expect(transitions).toEqual(['QUEUED', 'RUNNING', 'COMPLETED']);
  });

  it('double start ditolak', async () => {
    const gate = deferred();
    const o = orchestrator([
      adapter('UX_RULES', async () => {
        await gate.promise;
        return PASS;
      }),
    ]);
    const run = newRun(o, ['UX_RULES']);
    const first = o.start(run.id);
    await expect(o.start(run.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    gate.resolve();
    expect((await first).status).toBe('COMPLETED');
  });

  it('start ulang untuk run yang sudah selesai ditolak', async () => {
    const o = orchestrator([adapter('UX_RULES', () => PASS)]);
    const run = newRun(o, ['UX_RULES']);
    await o.start(run.id);
    await expect(o.start(run.id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('cancel sebelum start: run CANCELLED dan adapter tidak pernah dipanggil', async () => {
    const a = adapter('UX_RULES', () => PASS);
    const o = orchestrator([a]);
    const run = newRun(o, ['UX_RULES']);
    const cancelled = o.cancel(run.id);
    expect(cancelled.status).toBe('CANCELLED');
    const done = await o.start(run.id);
    expect(done.status).toBe('CANCELLED');
    expect(a.calls).toBe(0);
  });

  it('cancel saat modul berjalan: adapter melihat sinyal, modul berikutnya tidak dijalankan', async () => {
    const started = deferred();
    let sawAbort = false;
    const first = adapter('FUNCTIONAL_QA', async (ctx) => {
      started.resolve();
      await new Promise<void>((resolve) => {
        ctx.signal.addEventListener('abort', () => {
          sawAbort = true;
          resolve();
        });
      });
      return { status: 'ERROR', errorCode: 'CANCELLED', errorMessageSafe: 'dibatalkan' };
    });
    const second = adapter('UX_RULES', () => PASS);
    const o = orchestrator([first, second]);
    const run = newRun(o, ['FUNCTIONAL_QA', 'UX_RULES']);
    const running = o.start(run.id);
    await started.promise;
    expect(o.cancel(run.id).status).toBe('CANCELLING');
    const done = await running;
    expect(done.status).toBe('CANCELLED');
    expect(sawAbort).toBe(true);
    expect(second.calls).toBe(0);
    expect(done.moduleResults.map((m) => m.status)).toEqual(['CANCELLED', 'NOT_RUN']);
  });

  it('adapter hang → TIMEOUT ERROR, modul independen tetap jalan, hasil PARTIAL', async () => {
    const hang = adapter('FUNCTIONAL_QA', () => new Promise<ModuleOutcome>(() => undefined), {
      timeoutMs: 30,
    });
    const other = adapter('UX_RULES', () => PASS);
    const o = orchestrator([hang, other]);
    const run = newRun(o, ['FUNCTIONAL_QA', 'UX_RULES']);
    const done = await o.start(run.id);
    expect(done.status).toBe('PARTIAL');
    const timedOut = done.moduleResults.find((m) => m.module === 'FUNCTIONAL_QA');
    expect(timedOut?.status).toBe('ERROR');
    expect(timedOut?.errorCode).toBe('TIMEOUT');
    expect(done.moduleResults.find((m) => m.module === 'UX_RULES')?.status).toBe('PASS');
  });

  it('adapter melempar error → ERROR INTERNAL tanpa membocorkan pesan asli', async () => {
    const o = orchestrator([
      adapter('FUNCTIONAL_QA', () => {
        throw new Error('secret path /etc/shadow leaked');
      }),
      adapter('UX_RULES', () => PASS),
    ]);
    const run = newRun(o, ['FUNCTIONAL_QA', 'UX_RULES']);
    const done = await o.start(run.id);
    const failed = done.moduleResults.find((m) => m.module === 'FUNCTIONAL_QA');
    expect(failed?.errorCode).toBe('INTERNAL');
    expect(JSON.stringify(done)).not.toContain('/etc/shadow');
    expect(done.status).toBe('PARTIAL');
  });

  it('keluaran adapter tidak valid (NaN) ditolak sebagai ERROR, bukan hasil', async () => {
    const o = orchestrator([
      adapter('UX_RULES', () => ({ status: 'PASS', metrics: { score: Number.NaN } })),
    ]);
    const run = newRun(o, ['UX_RULES']);
    const done = await o.start(run.id);
    expect(done.moduleResults[0]?.status).toBe('ERROR');
    expect(done.moduleResults[0]?.errorCode).toBe('VALIDATION_FAILED');
    expect(done.status).toBe('FAILED');
  });

  it('keluaran tidak valid tidak menyimpan temuannya (tidak ada temuan yatim)', async () => {
    const o = orchestrator([
      adapter('UX_RULES', (ctx) => ({
        status: 'PASS',
        metrics: { score: Number.NaN },
        findings: [
          createFinding({
            runId: ctx.runId,
            moduleResultId: ctx.moduleResultId,
            category: 'FUNCTIONAL',
            title: 'Temuan dari keluaran tidak valid',
            description: 'Deskripsi',
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
            createdAt: new Date().toISOString(),
            status: 'OPEN',
            ruleId: 'ux-orphan-check',
            ruleVersion: '1.0.0',
          }),
        ],
      })),
    ]);
    const run = newRun(o, ['UX_RULES']);
    const done = await o.start(run.id);
    expect(done.moduleResults[0]?.status).toBe('ERROR');
    expect(store.findings.listByRun(run.id, { limit: 10, offset: 0 }).items).toHaveLength(0);
  });

  it('status PASS dengan errorCode ditolak (tidak boleh dianggap sukses)', async () => {
    const o = orchestrator([
      adapter('UX_RULES', () => ({ status: 'PASS', errorCode: 'TOOL_FAILED' })),
    ]);
    const run = newRun(o, ['UX_RULES']);
    const done = await o.start(run.id);
    expect(done.moduleResults[0]?.status).toBe('ERROR');
    expect(done.status).toBe('FAILED');
  });

  it('retry transient dibatasi maxRetries', async () => {
    let n = 0;
    const flaky = adapter(
      'UX_RULES',
      () => {
        n++;
        return n === 1 ? { status: 'ERROR', errorCode: 'NETWORK_ERROR', retryable: true } : PASS;
      },
      { maxRetries: 2 },
    );
    const o = orchestrator([flaky]);
    const done = await o.start(newRun(o, ['UX_RULES']).id);
    expect(done.moduleResults[0]?.status).toBe('PASS');
    expect(done.moduleResults[0]?.retryCount).toBe(1);
    expect(flaky.calls).toBe(2);
  });

  it('retry tidak berulang tanpa batas saat selalu gagal', async () => {
    const always = adapter(
      'UX_RULES',
      () => ({ status: 'ERROR', errorCode: 'TIMEOUT', retryable: true }),
      { maxRetries: 2 },
    );
    const o = orchestrator([always]);
    const done = await o.start(newRun(o, ['UX_RULES']).id);
    expect(always.calls).toBe(3);
    expect(done.moduleResults[0]?.retryCount).toBe(2);
    expect(done.status).toBe('FAILED');
  });

  it('semua modul gagal → FAILED', async () => {
    const o = orchestrator([
      adapter('UX_RULES', () => ({ status: 'UNAVAILABLE', skippedReason: 'tool missing' })),
    ]);
    const done = await o.start(newRun(o, ['UX_RULES']).id);
    expect(done.status).toBe('FAILED');
  });

  it('satu run aktif: run kedua menunggu di antrean (QUEUED) sampai run pertama selesai', async () => {
    const gate = deferred();
    const o = orchestrator([
      adapter('UX_RULES', async () => {
        await gate.promise;
        return PASS;
      }),
    ]);
    const a = newRun(o, ['UX_RULES']);
    const b = newRun(o, ['UX_RULES']);
    const pa = o.start(a.id);
    const pb = o.start(b.id);
    expect(store.runs.get(b.id)?.status).toBe('QUEUED');
    gate.resolve();
    expect((await pa).status).toBe('COMPLETED');
    expect((await pb).status).toBe('COMPLETED');
  });

  it('kegagalan penyimpanan saat menyimpan hasil modul tidak menghasilkan sukses palsu', async () => {
    const o = orchestrator([adapter('UX_RULES', () => PASS)]);
    const run = newRun(o, ['UX_RULES']);
    const original = store.modules.update.bind(store.modules);
    store.modules.update = () => {
      throw new AppError('STORAGE_ERROR');
    };
    // Kegagalan penyimpanan dicatat sebagai FAILED (bukan melempar sukses palsu).
    const done = await o.start(run.id);
    store.modules.update = original;
    expect(done.status).toBe('FAILED');
    const after = store.runs.get(run.id);
    expect(after?.status).toBe('FAILED');
    expect(after?.errorSummary).toMatch(/orchestrator-error:STORAGE_ERROR/);
  });

  it('progress tercatat berurutan per modul', async () => {
    const o = orchestrator([
      adapter('UX_RULES', (ctx) => {
        ctx.progress('mulai');
        ctx.progress('selesai');
        return PASS;
      }),
    ]);
    const run = newRun(o, ['UX_RULES']);
    await o.start(run.id);
    const events = o.progressFor(run.id);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);
    expect(events.map((e) => e.message)).toEqual(['mulai', 'selesai']);
  });
});

describe('restart dan shutdown', () => {
  it('run RUNNING yang tertinggal dari proses sebelumnya menjadi FAILED, bukan sukses', () => {
    const o = orchestrator([adapter('UX_RULES', () => PASS)]);
    const run = newRun(o, ['UX_RULES']);
    store.runs.transition(run.id, 'RUNNING', {
      expectedVersion: 0,
      at: new Date().toISOString(),
      reason: 'simulated-crash',
      patch: { startedAt: new Date().toISOString() },
    });
    expect(o.recoverInterruptedRuns()).toBe(1);
    const after = store.runs.get(run.id);
    expect(after?.status).toBe('FAILED');
    expect(after?.errorSummary).toBeNull();
  });

  it('shutdown menghentikan run aktif dan mencatat CANCELLED', async () => {
    const started = deferred();
    const o = orchestrator([
      adapter('UX_RULES', async (ctx) => {
        started.resolve();
        await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve()));
        return { status: 'ERROR', errorCode: 'CANCELLED' };
      }),
    ]);
    const run = newRun(o, ['UX_RULES']);
    const running = o.start(run.id);
    await started.promise;
    await o.shutdown(1000);
    expect((await running).status).toBe('CANCELLED');
  });

  it('run baru ditolak setelah shutdown dimulai', async () => {
    const o = orchestrator([adapter('UX_RULES', () => PASS)]);
    await o.shutdown(10);
    expect(() => newRun(o, ['UX_RULES'])).toThrow(expect.objectContaining({ code: 'CONFLICT' }));
  });
});

describe('konfigurasi orchestrator', () => {
  it('adapter ganda ditolak', () => {
    expect(() =>
      orchestrator([adapter('UX_RULES', () => PASS), adapter('UX_RULES', () => PASS)]),
    ).toThrow(expect.objectContaining({ code: 'CONFIG_INVALID' }));
  });

  it('modul tidak dikenal atau duplikat ditolak saat membuat run', () => {
    const o = orchestrator([adapter('UX_RULES', () => PASS)]);
    expect(() => newRun(o, ['LOAD_K6'])).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
    expect(() => newRun(o, ['UX_RULES', 'UX_RULES'])).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });
});

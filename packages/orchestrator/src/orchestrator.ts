import {
  AppError,
  createModuleResult,
  createRun,
  MODULE_STATUSES,
  newId,
  toSafeError,
  type ModuleErrorCode,
  type Finding,
  type ModuleName,
  type ModuleResult,
  type ModuleStatus,
  type Run,
  type ScopeGrant,
  type Target,
} from '@nusawebbench/core';
import type { Store } from '@nusawebbench/storage';
import { aggregateRunStatus } from './aggregate.js';
import { authorizationFor, buildRunPlan } from './plan.js';

/** Hasil satu modul dari adapter. Adapter wajib mematuhi `ctx.signal`. */
/** Hasil satu modul dari adapter. Adapter wajib mematuhi `ctx.signal`. */
export type ModuleOutcome = {
  readonly status: Exclude<ModuleStatus, 'QUEUED' | 'RUNNING'>;
  readonly metrics?: Readonly<Record<string, number>>;
  /** Temuan yang dihasilkan modul. Hanya disimpan bila status modul PASS/FAIL/WARN. */
  readonly findings?: readonly Finding[];
  readonly artifactRefs?: readonly string[];
  readonly toolName?: string | null;
  readonly toolVersion?: string | null;
  readonly errorCode?: ModuleErrorCode | null;
  readonly errorMessageSafe?: string | null;
  readonly skippedReason?: string | null;
  /** Hanya true bila kegagalan bersifat sementara (mis. timeout jaringan). */
  readonly retryable?: boolean;
};

export type ModuleContext = {
  readonly runId: string;
  /** ID ModuleResult yang sedang berjalan; temuan harus mereferensinya. */
  readonly moduleResultId: string;
  readonly targetOrigin: string;
  readonly grant: ScopeGrant;
  readonly signal: AbortSignal;
  /** Catatan progres. Disimpan berurutan per modul; tidak memuat data sensitif. */
  readonly progress: (message: string) => void;
};

export interface ModuleAdapter {
  readonly module: ModuleName;
  readonly required: boolean;
  readonly timeoutMs: number;
  readonly maxRetries: number;
  run(ctx: ModuleContext): Promise<ModuleOutcome>;
}

export type OrchestratorOptions = {
  readonly store: Store;
  readonly adapters: readonly ModuleAdapter[];
  readonly now?: () => Date;
  /** Logger aman: menerima pesan tanpa data sensitif. */
  readonly log?: (message: string) => void;
};

export type ProgressEvent = { runId: string; module: ModuleName; seq: number; message: string };

const MODULES_KEY = 'MODULES';

/**
 * Orchestrator run (taskbook T-050). Satu run dieksekusi pada satu waktu melalui antrean
 * serial. Setiap transisi status memakai compare-and-set pada storage. Modul dijalankan
 * berurutan; kegagalan satu modul diisolasi dan tidak menghentikan modul independen.
 */
export class RunOrchestrator {
  private readonly store: Store;
  private readonly adapters: ReadonlyMap<ModuleName, ModuleAdapter>;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;
  private readonly controllers = new Map<string, AbortController>();
  private readonly idempotency = new Map<string, string>();
  private readonly progressLog: ProgressEvent[] = [];
  private queue: Promise<void> = Promise.resolve();
  private closing = false;

  constructor(options: OrchestratorOptions) {
    this.store = options.store;
    this.adapters = new Map(options.adapters.map((a) => [a.module, a]));
    if (this.adapters.size !== options.adapters.length) {
      throw new AppError('CONFIG_INVALID', { debugDetail: 'duplicate-module-adapter' });
    }
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? (() => undefined);
  }

  /** Progres yang sudah tercatat (salinan). Dipakai dashboard dan tes. */
  progressFor(runId: string): ProgressEvent[] {
    return this.progressLog.filter((e) => e.runId === runId).map((e) => ({ ...e }));
  }

  /**
   * Membuat run QUEUED. Idempotency key yang sama mengembalikan run yang sudah ada, sehingga
   * double click atau retry API tidak membuat run ganda.
   */
  createRun(input: {
    target: Target;
    grant: ScopeGrant;
    modules: readonly ModuleName[];
    acknowledged: boolean;
    idempotencyKey?: string;
    configSnapshot?: Record<string, string | number | boolean | null>;
  }): Run {
    if (this.closing) {
      throw new AppError('CONFLICT', { safeMessage: 'Server sedang berhenti. Coba lagi nanti.' });
    }
    if (input.idempotencyKey !== undefined) {
      const existingId = this.idempotency.get(input.idempotencyKey);
      if (existingId !== undefined) {
        const existing = this.store.runs.get(existingId);
        if (existing) return existing;
      }
    }
    if (input.target.mode === 'repository') {
      throw new AppError('VALIDATION_FAILED', {
        safeMessage: 'Target repository tidak dijalankan di sini.',
      });
    }
    const expectedMode = input.target.mode === 'fixture' ? 'local-fixture' : 'remote';
    if (input.target.origin !== input.grant.origin || input.grant.mode !== expectedMode) {
      throw new AppError('SCOPE_DENIED');
    }
    const modules = [...new Set(input.modules)];
    if (modules.length !== input.modules.length || modules.length === 0) {
      throw new AppError('VALIDATION_FAILED', { safeMessage: 'Daftar modul tidak valid.' });
    }
    for (const m of modules) {
      if (!this.adapters.has(m)) {
        throw new AppError('VALIDATION_FAILED', { safeMessage: 'Modul tidak dikenal.' });
      }
    }
    const plan = buildRunPlan({ origin: input.grant.origin, mode: input.grant.mode, modules });
    if (!plan.allowed) {
      throw new AppError('SCOPE_DENIED', {
        ...(plan.blockedReason !== null ? { safeMessage: plan.blockedReason } : {}),
        debugDetail: 'plan-not-allowed',
      });
    }
    const authorization = authorizationFor({
      grant: input.grant,
      acknowledged: input.acknowledged,
      now: this.now(),
    });
    const run = createRun({
      targetId: input.target.id,
      targetOrigin: input.target.origin,
      targetMode: input.target.mode,
      authorization,
      configSnapshot: { ...(input.configSnapshot ?? {}), [MODULES_KEY]: modules.join(',') },
      now: this.now(),
    });
    this.store.runs.insert(run);
    if (input.idempotencyKey !== undefined) {
      this.idempotency.set(input.idempotencyKey, run.id);
    }
    return run;
  }

  /**
   * Menjalankan run. Panggilan kedua untuk run yang sama ditolak (double start). Eksekusi
   * diserialkan sehingga hanya satu run aktif pada satu waktu.
   */
  start(runId: string): Promise<Run> {
    if (this.controllers.has(runId)) {
      return Promise.reject(new AppError('CONFLICT', { safeMessage: 'Run sudah dimulai.' }));
    }
    const controller = new AbortController();
    this.controllers.set(runId, controller);
    const job = this.queue.then(() => this.execute(runId, controller));
    this.queue = job.then(
      () => undefined,
      () => undefined,
    );
    return job.finally(() => {
      this.controllers.delete(runId);
    });
  }

  /**
   * Meminta pembatalan. QUEUED langsung menjadi CANCELLED. RUNNING menjadi CANCELLING, lalu
   * CANCELLED setelah modul aktif berhenti. Status terminal dikembalikan apa adanya.
   */
  cancel(runId: string, reason = 'user-requested'): Run {
    const run = this.requireRun(runId);
    const controller = this.controllers.get(runId);
    if (run.status === 'QUEUED') {
      controller?.abort();
      return this.transitionWithRetry(runId, 'CANCELLED', reason);
    }
    if (run.status === 'RUNNING') {
      controller?.abort();
      return this.transitionWithRetry(runId, 'CANCELLING', reason);
    }
    return run;
  }

  /**
   * Shutdown aman: hentikan run aktif, tunggu grace period, lalu tandai sisanya FAILED
   * (bukan sukses). Dipanggil saat SIGINT/SIGTERM.
   */
  async shutdown(graceMs: number): Promise<void> {
    this.closing = true;
    for (const [runId, controller] of this.controllers) {
      controller.abort();
      this.log(`shutdown: meminta penghentian run ${runId}`);
    }
    const drained = this.queue.then(() => 'drained' as const);
    const timeout = new Promise<'timeout'>((resolve) => {
      setTimeout(() => resolve('timeout'), graceMs).unref();
    });
    const outcome = await Promise.race([drained, timeout]);
    if (outcome === 'timeout') {
      for (const run of this.store.runs.list({ limit: 200 })) {
        if (run.status === 'RUNNING' || run.status === 'CANCELLING') {
          this.transitionWithRetry(run.id, 'FAILED', 'shutdown-grace-exceeded', {
            errorSummary: 'shutdown-grace-exceeded',
          });
        }
      }
    }
  }

  /**
   * Dipanggil saat startup. Run yang tertinggal QUEUED/RUNNING/CANCELLING dari proses
   * sebelumnya ditandai FAILED (atau CANCELLED untuk yang belum mulai). Tidak pernah sukses.
   */
  recoverInterruptedRuns(): number {
    let recovered = 0;
    for (const run of this.store.runs.list({ limit: 200 })) {
      if (run.status === 'QUEUED') {
        this.transitionWithRetry(run.id, 'CANCELLED', 'interrupted-by-restart');
        recovered++;
      } else if (run.status === 'RUNNING' || run.status === 'CANCELLING') {
        this.transitionWithRetry(run.id, 'FAILED', 'interrupted-by-restart', {
          errorSummary: 'interrupted-by-restart',
        });
        recovered++;
      }
    }
    return recovered;
  }

  private requireRun(runId: string): Run {
    const run = this.store.runs.get(runId);
    if (!run) throw new AppError('NOT_FOUND');
    return run;
  }

  private transitionWithRetry(
    runId: string,
    to: Run['status'],
    reason: string,
    patch: { startedAt?: string; completedAt?: string; errorSummary?: string | null } = {},
  ): Run {
    // Status terminal selalu membawa completedAt (dicek schema Run).
    const terminal =
      to === 'CANCELLED' || to === 'COMPLETED' || to === 'PARTIAL' || to === 'FAILED';
    const fullPatch =
      terminal && patch.completedAt === undefined
        ? { ...patch, completedAt: this.now().toISOString() }
        : patch;
    // Satu kali percobaan ulang bila versi berubah karena pembaruan konkuren.
    for (let attempt = 0; attempt < 2; attempt++) {
      const version = this.store.runs.version(runId);
      if (version === null) throw new AppError('NOT_FOUND');
      try {
        return this.store.runs.transition(runId, to, {
          expectedVersion: version,
          at: this.now().toISOString(),
          reason,
          ...(Object.keys(fullPatch).length > 0 ? { patch: fullPatch } : {}),
        });
      } catch (err) {
        if (attempt === 1 || !(err instanceof AppError) || err.code !== 'CONFLICT') throw err;
        const latest = this.store.runs.get(runId);
        if (latest && latest.status === to) return latest;
      }
    }
    throw new AppError('CONFLICT');
  }

  private async execute(runId: string, controller: AbortController): Promise<Run> {
    const initial = this.requireRun(runId);
    if (initial.status !== 'QUEUED') {
      if (initial.status === 'CANCELLED') return initial;
      throw new AppError('CONFLICT', { safeMessage: 'Run tidak dalam status siap dijalankan.' });
    }
    if (controller.signal.aborted) {
      return this.transitionWithRetry(runId, 'CANCELLED', 'cancelled-before-start');
    }
    const moduleNames = this.modulesOf(initial);
    const grant: ScopeGrant = {
      origin: initial.targetOrigin,
      mode: initial.targetMode === 'fixture' ? 'local-fixture' : 'remote',
    };

    this.transitionWithRetry(runId, 'RUNNING', 'started', {
      startedAt: this.now().toISOString(),
    });
    const results: { module: ModuleName; status: ModuleStatus; required: boolean }[] = [];
    try {
      for (const name of moduleNames) {
        const adapter = this.adapters.get(name);
        if (!adapter) throw new AppError('CONFIG_INVALID', { debugDetail: 'adapter-missing' });
        if (controller.signal.aborted) {
          const r = this.recordSkipped(runId, name, 'NOT_RUN', 'run-cancelled');
          results.push({ module: name, status: r.status, required: adapter.required });
          continue;
        }
        const result = await this.runModule(runId, adapter, grant, controller.signal);
        results.push({ module: name, status: result.status, required: adapter.required });
      }
      const status = aggregateRunStatus({
        cancelRequested: controller.signal.aborted,
        modules: results.map((r) => ({
          module: r.module,
          status: r.status,
          required: r.required,
        })),
      });
      return this.finish(runId, status, status === 'CANCELLED' ? 'cancelled' : 'completed');
    } catch (err) {
      // Kegagalan tak terduga (mis. DB tidak tersedia) tidak boleh berakhir sebagai sukses.
      const safe = toSafeError(err);
      this.log(`run ${runId} gagal: ${safe.code}`);
      try {
        return this.finish(runId, 'FAILED', `orchestrator-error:${safe.code}`);
      } catch {
        // Penyimpanan juga gagal; status tetap RUNNING/CANCELLING dan dipulihkan saat startup.
        throw err;
      }
    }
  }

  /**
   * Menutup run dengan status akhir. Jika pembatalan diminta (CANCELLING), hasil akhir selalu
   * CANCELLED. Status terminal yang sudah ada dikembalikan apa adanya.
   */
  private finish(
    runId: string,
    status: 'CANCELLED' | 'COMPLETED' | 'PARTIAL' | 'FAILED',
    reason: string,
  ): Run {
    let current = this.requireRun(runId);
    const completedAt = this.now().toISOString();
    if (current.status === 'RUNNING' && status === 'CANCELLED') {
      current = this.transitionWithRetry(runId, 'CANCELLING', 'cancel-observed');
    }
    if (current.status === 'CANCELLING') {
      return this.transitionWithRetry(runId, 'CANCELLED', reason, { completedAt });
    }
    if (current.status !== 'RUNNING') return current;
    return this.transitionWithRetry(runId, status, reason, {
      completedAt,
      errorSummary: status === 'FAILED' ? reason : null,
    });
  }

  private modulesOf(run: Run): ModuleName[] {
    const raw = run.configSnapshot[MODULES_KEY];
    if (typeof raw !== 'string' || raw === '') {
      throw new AppError('CONFIG_INVALID', { debugDetail: 'run-without-modules' });
    }
    return raw.split(',').map((m) => {
      if (!this.adapters.has(m as ModuleName)) {
        throw new AppError('CONFIG_INVALID', { debugDetail: 'unknown-module-in-run' });
      }
      return m as ModuleName;
    });
  }

  private recordSkipped(
    runId: string,
    module: ModuleName,
    status: 'NOT_RUN' | 'SKIPPED',
    reason: string,
  ): ModuleResult {
    const now = this.now().toISOString();
    const result = createModuleResult({
      runId,
      module,
      status,
      startedAt: null,
      completedAt: now,
      durationMs: null,
      toolName: null,
      toolVersion: null,
      configSnapshot: {},
      metrics: {},
      findingIds: [],
      artifactRefs: [],
      errorCode: null,
      errorMessageSafe: null,
      retryCount: 0,
      skippedReason: reason,
    });
    this.store.modules.insert(result);
    return result;
  }

  private async runModule(
    runId: string,
    adapter: ModuleAdapter,
    grant: ScopeGrant,
    runSignal: AbortSignal,
  ): Promise<ModuleResult> {
    const startedAt = this.now();
    const base = {
      id: newId('module'),
      runId,
      module: adapter.module,
      startedAt: startedAt.toISOString(),
    };
    this.store.modules.insert(
      createModuleResult({
        ...base,
        status: 'RUNNING',
        completedAt: null,
        durationMs: null,
        toolName: null,
        toolVersion: null,
        configSnapshot: {},
        metrics: {},
        findingIds: [],
        artifactRefs: [],
        errorCode: null,
        errorMessageSafe: null,
        retryCount: 0,
        skippedReason: null,
      }),
    );

    let retryCount = 0;
    let outcome: ModuleOutcome;
    for (;;) {
      outcome = await this.invokeAdapter(adapter, runId, base.id, grant, runSignal);
      if (outcome.retryable !== true || retryCount >= adapter.maxRetries || runSignal.aborted)
        break;
      retryCount++;
    }

    // Keluaran divalidasi SEBELUM temuan disimpan. Bila tidak valid, outcome diganti ERROR
    // sehingga temuannya tidak tersimpan sebagai yatim tanpa referensi modul.
    const checked = this.checkOutcome(base, outcome, retryCount, startedAt);
    const persisted = this.persistFindings(runId, base.id, checked);
    const finalResult = this.toModuleResult(
      base,
      checked,
      persisted,
      retryCount,
      startedAt,
      this.now(),
    );
    this.store.modules.update(finalResult);
    return finalResult;
  }

  /** Memeriksa keluaran adapter dengan membangun hasil modul uji. Tidak menyimpan apa pun. */
  private checkOutcome(
    base: { id: string; runId: string; module: ModuleName; startedAt: string },
    outcome: ModuleOutcome,
    retryCount: number,
    startedAt: Date,
  ): ModuleOutcome {
    if (outcome.status === 'ERROR') return outcome;
    const probe = this.toModuleResult(
      base,
      outcome,
      (outcome.findings ?? []).map((f) => f.id),
      retryCount,
      startedAt,
      startedAt,
    );
    if (probe.status === 'ERROR' && probe.errorCode === 'VALIDATION_FAILED') {
      return {
        status: 'ERROR',
        errorCode: 'VALIDATION_FAILED',
        errorMessageSafe: 'Keluaran modul tidak valid dan ditolak.',
      };
    }
    return outcome;
  }

  /**
   * Menyimpan temuan yang valid. Temuan yang tidak mereferensi run dan modul ini ditolak;
   * temuan dari modul ERROR/UNAVAILABLE/SKIPPED diabaikan (tidak ada hasil untuk dilaporkan).
   */
  private persistFindings(runId: string, moduleResultId: string, outcome: ModuleOutcome): string[] {
    const isResult =
      outcome.status === 'PASS' || outcome.status === 'FAIL' || outcome.status === 'WARN';
    if (!isResult || !outcome.findings || outcome.findings.length === 0) return [];
    const ids: string[] = [];
    for (const finding of outcome.findings) {
      if (finding.runId !== runId || finding.moduleResultId !== moduleResultId) {
        this.log(`temuan ditolak: tidak mereferensi run/modul yang benar`);
        continue;
      }
      // Duplikat (sidik jari sama) tidak dimasukkan ulang; referensinya tidak diklaim.
      if (this.store.findings.insertIfNew(finding)) ids.push(finding.id);
    }
    return ids;
  }

  /** Menjalankan satu adapter dengan timeout dan isolasi error. Tidak pernah melempar. */
  private async invokeAdapter(
    adapter: ModuleAdapter,
    runId: string,
    moduleResultId: string,
    grant: ScopeGrant,
    runSignal: AbortSignal,
  ): Promise<ModuleOutcome> {
    const moduleController = new AbortController();
    let seq = 0;
    const progress = (message: string) => {
      seq++;
      this.progressLog.push({ runId, module: adapter.module, seq, message: message.slice(0, 300) });
    };
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onRunAbort: (() => void) | undefined;
    // Timeout dan pembatalan run adalah dua jalur berbeda: timeout → ERROR/TIMEOUT,
    // pembatalan run → CANCELLED. Keduanya menghentikan sinyal modul.
    const timedOut = new Promise<ModuleOutcome>((resolve) => {
      timer = setTimeout(() => {
        resolve({
          status: 'ERROR',
          errorCode: 'TIMEOUT',
          errorMessageSafe: 'Modul melewati batas waktu.',
        });
        moduleController.abort();
      }, adapter.timeoutMs);
    });
    const cancelled = new Promise<ModuleOutcome>((resolve) => {
      onRunAbort = () => {
        resolve({
          status: 'CANCELLED',
          errorCode: 'CANCELLED',
          errorMessageSafe: 'Run dibatalkan.',
        });
        moduleController.abort();
      };
      if (runSignal.aborted) onRunAbort();
      else runSignal.addEventListener('abort', onRunAbort, { once: true });
    });
    const attempt = (async (): Promise<ModuleOutcome> => {
      try {
        return await adapter.run({
          runId,
          moduleResultId,
          targetOrigin: grant.origin,
          grant,
          signal: moduleController.signal,
          progress,
        });
      } catch (err) {
        // Detail error asli tidak masuk hasil; hanya kode aman yang dicatat.
        this.log(`modul ${adapter.module} melempar error: ${toSafeError(err).code}`);
        return {
          status: 'ERROR',
          errorCode: 'INTERNAL',
          errorMessageSafe: 'Modul gagal dijalankan.',
        };
      }
    })();
    try {
      return await Promise.race([attempt, timedOut, cancelled]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onRunAbort !== undefined) runSignal.removeEventListener('abort', onRunAbort);
    }
  }

  private toModuleResult(
    base: { id: string; runId: string; module: ModuleName; startedAt: string },
    outcome: ModuleOutcome,
    findingIds: readonly string[],
    retryCount: number,
    startedAt: Date,
    completedAt: Date,
  ): ModuleResult {
    const status = MODULE_STATUSES.includes(outcome.status) ? outcome.status : 'ERROR';
    const isResult = status === 'PASS' || status === 'FAIL' || status === 'WARN';
    const durationMs = Math.max(0, completedAt.getTime() - startedAt.getTime());
    try {
      return createModuleResult({
        ...base,
        status,
        completedAt: completedAt.toISOString(),
        durationMs,
        toolName: outcome.toolName ?? null,
        toolVersion: outcome.toolVersion ?? null,
        configSnapshot: {},
        metrics: isResult ? { ...(outcome.metrics ?? {}) } : {},
        findingIds: isResult ? [...findingIds] : [],
        artifactRefs: [...(outcome.artifactRefs ?? [])],
        errorCode: outcome.errorCode ?? null,
        errorMessageSafe: outcome.errorMessageSafe ?? null,
        retryCount,
        skippedReason: outcome.skippedReason ?? null,
      });
    } catch {
      // Keluaran adapter tidak valid: dicatat sebagai ERROR, tidak pernah diteruskan sebagai hasil.
      return createModuleResult({
        ...base,
        status: 'ERROR',
        completedAt: completedAt.toISOString(),
        durationMs,
        toolName: null,
        toolVersion: null,
        configSnapshot: {},
        metrics: {},
        findingIds: [],
        artifactRefs: [],
        errorCode: 'VALIDATION_FAILED',
        errorMessageSafe: 'Keluaran modul tidak valid dan ditolak.',
        retryCount,
        skippedReason: null,
      });
    }
  }
}

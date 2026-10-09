import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { AppError, checkUrlInScope } from '@nusawebbench/core';
import type { ModuleAdapter, ModuleContext, ModuleOutcome } from '@nusawebbench/orchestrator';
import type { ArtifactStore } from '@nusawebbench/storage';

/**
 * Load test terbatas (taskbook T-150). Default nonaktif. Hanya preset tetap; stress, flood, dan
 * spike tidak tersedia pada MVP. Script k6 dibuat dari nilai yang sudah divalidasi dan diserialisasi
 * dengan JSON.stringify; tidak ada input mentah yang masuk ke sumber JavaScript.
 */

export const K6_TOOL = 'k6';
/** Batas keras. Konfigurasi tidak dapat melampauinya, termasuk lewat environment. */
export const K6_LIMITS = Object.freeze({
  maxVus: 2,
  maxRatePerSec: 5,
  maxDurationSec: 30,
  maxTotalRequests: 100,
  timeoutMs: 60_000,
  summaryMaxBytes: 2 * 1024 * 1024,
});
export const K6_PRESETS = ['fixed-smoke'] as const;

const UrlPathSchema = z
  .string()
  .max(200)
  .regex(/^\/[A-Za-z0-9/_.-]{0,199}$/, { message: 'path-not-allowed' })
  .refine((p) => !p.includes('..'), { message: 'path-traversal' })
  // Path yang diawali "//" menjadi URL protocol-relative (host berpindah).
  .refine((p) => !p.includes('//'), { message: 'protocol-relative-path' });

export const K6ConfigSchema = z
  .strictObject({
    enabled: z.boolean().default(false),
    preset: z.enum(K6_PRESETS).default('fixed-smoke'),
    path: UrlPathSchema.default('/'),
    vus: z.number().int().min(1).max(K6_LIMITS.maxVus).default(1),
    ratePerSec: z.number().int().min(1).max(K6_LIMITS.maxRatePerSec).default(2),
    durationSec: z.number().int().min(1).max(K6_LIMITS.maxDurationSec).default(10),
    /** Konfirmasi remote terpisah. Tetap tidak cukup: buildRunPlan memblokir LOAD_K6 untuk remote. */
    remoteAcknowledged: z.boolean().default(false),
  })
  .superRefine((c, ctx) => {
    // Jumlah request yang direncanakan = rate × durasi (VU hanya menentukan konkurensi).
    if (c.ratePerSec * c.durationSec > K6_LIMITS.maxTotalRequests) {
      ctx.addIssue({ code: 'custom', path: ['durationSec'], message: 'total-request-cap' });
    }
  });
export type K6Config = z.infer<typeof K6ConfigSchema>;

export function parseK6Config(raw: unknown): K6Config {
  const parsed = K6ConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError('CONFIG_INVALID', { debugDetail: 'k6-config' });
  return parsed.data;
}

/** Membuat source script k6. Hanya menerima nilai yang sudah lolos K6ConfigSchema dan URL absolut. */
export function buildK6Script(input: {
  url: string;
  vus: number;
  ratePerSec: number;
  durationSec: number;
}): string {
  const url = new URL(input.url);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new AppError('CONFIG_INVALID', { debugDetail: 'k6-protocol' });
  for (const n of [input.vus, input.ratePerSec, input.durationSec]) {
    if (!Number.isSafeInteger(n) || n < 1)
      throw new AppError('CONFIG_INVALID', { debugDetail: 'k6-number' });
  }
  const json = (v: unknown) => JSON.stringify(v);
  return [
    "import http from 'k6/http';",
    "import { check } from 'k6';",
    `const TARGET = ${json(url.href)};`,
    `const VUS = ${json(input.vus)};`,
    `const RATE = ${json(input.ratePerSec)};`,
    `const DURATION = ${json(`${input.durationSec}s`)};`,
    'export const options = {',
    '  scenarios: { fixed: { executor: "constant-arrival-rate", rate: RATE, timeUnit: "1s", duration: DURATION, preAllocatedVUs: VUS, maxVUs: VUS } },',
    '  thresholds: { http_req_failed: ["rate<0.05"] },',
    '};',
    'export default function () {',
    '  const r = http.get(TARGET, { timeout: "5s" });',
    '  check(r, { "status 2xx/3xx": (x) => x.status >= 200 && x.status < 400 });',
    '}',
    '',
  ].join('\n');
}

/** Ringkasan k6 yang divalidasi. Metrik yang tidak ada tidak diisi (tidak dikarang). */
const SummarySchema = z
  .object({
    metrics: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

export function parseK6Summary(text: string): {
  requests: number | null;
  failedRate: number | null;
  p95Ms: number | null;
} {
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch {
    throw new AppError('VALIDATION_FAILED', { debugDetail: 'k6-summary-json' });
  }
  const parsed = SummarySchema.safeParse(raw);
  if (!parsed.success || !parsed.data.metrics)
    throw new AppError('VALIDATION_FAILED', { debugDetail: 'k6-summary-shape' });
  const m = parsed.data.metrics;
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const reqs = m['http_reqs'] as { count?: unknown } | undefined;
  const failed = m['http_req_failed'] as { value?: unknown } | undefined;
  const dur = m['http_req_duration'] as { 'p(95)'?: unknown } | undefined;
  return {
    requests: num(reqs?.count),
    failedRate: num(failed?.value),
    p95Ms: num(dur?.['p(95)']),
  };
}

export type K6AdapterOptions = {
  readonly artifacts: ArtifactStore;
  readonly config?: unknown;
  /** Path executable k6. Tidak ada default ke PATH tanpa diisi (environment K6_BIN). */
  readonly k6Path?: string | undefined;
  readonly timeoutMs?: number;
  /** Hook uji: spawn pengganti. Default memakai child_process.spawn. */
  readonly spawnFn?: typeof spawn;
};

const execFileAsync = promisify(execFile);
const VERSION_RE = /k6 v(\d+\.\d+\.\d+)/;

export class K6Adapter implements ModuleAdapter {
  readonly module = 'LOAD_K6' as const;
  readonly required = false;
  readonly timeoutMs: number;
  readonly maxRetries = 0;
  private readonly rawConfig: unknown;
  private readonly k6Path: string | undefined;
  private readonly spawnFn: typeof spawn;

  constructor(private readonly options: K6AdapterOptions) {
    this.rawConfig = options.config ?? {};
    this.k6Path = options.k6Path ?? (process.env['K6_BIN'] || undefined);
    this.timeoutMs = Math.min(options.timeoutMs ?? K6_LIMITS.timeoutMs, K6_LIMITS.timeoutMs);
    this.spawnFn = options.spawnFn ?? spawn;
  }

  async run(ctx: ModuleContext): Promise<ModuleOutcome> {
    let config: K6Config;
    try {
      config = parseK6Config(this.rawConfig);
    } catch {
      return {
        status: 'ERROR',
        errorCode: 'CONFIG_INVALID',
        errorMessageSafe: 'Konfigurasi load test tidak valid.',
      };
    }
    if (!config.enabled) {
      return { status: 'SKIPPED', skippedReason: 'k6-disabled' };
    }
    if (ctx.grant.mode !== 'local-fixture' && !config.remoteAcknowledged) {
      return { status: 'SKIPPED', skippedReason: 'remote-not-acknowledged' };
    }
    if (ctx.grant.mode !== 'local-fixture') {
      // Gerbang kedua di tingkat adapter; buildRunPlan sudah memblokir remote untuk LOAD_K6.
      return {
        status: 'ERROR',
        errorCode: 'SCOPE_DENIED',
        errorMessageSafe: 'Load test remote tidak diizinkan pada MVP.',
      };
    }

    const target = new URL(config.path, ctx.grant.origin).href;
    const scope = await checkUrlInScope(target, ctx.grant);
    if (!scope.allowed) {
      return {
        status: 'ERROR',
        errorCode: 'SCOPE_DENIED',
        errorMessageSafe: 'Target load test di luar cakupan.',
      };
    }

    // Pemeriksaan executable (tool missing).
    if (this.k6Path === undefined || !isExecutableFile(this.k6Path)) {
      return unavailable();
    }
    let toolVersion: string;
    try {
      const { stdout } = await execFileAsync(this.k6Path, ['version'], {
        timeout: 10_000,
        env: safeEnv(),
      });
      const m = VERSION_RE.exec(stdout);
      if (!m?.[1]) return unavailable();
      toolVersion = m[1];
    } catch {
      return unavailable();
    }

    ctx.progress('k6: menyiapkan script');
    const runDir = mkdtempSync(path.join(tmpdir(), 'nwb-k6-'));
    try {
      const scriptPath = path.join(runDir, 'script.js');
      const summaryPath = path.join(runDir, 'summary.json');
      writeFileSync(
        scriptPath,
        buildK6Script({
          url: target,
          vus: config.vus,
          ratePerSec: config.ratePerSec,
          durationSec: config.durationSec,
        }),
        { mode: 0o600 },
      );
      // Validasi ulang tepat sebelum spawn (taskbook T-150 instruksi 4).
      const again = await checkUrlInScope(target, ctx.grant);
      if (!again.allowed)
        return {
          status: 'ERROR',
          errorCode: 'SCOPE_DENIED',
          errorMessageSafe: 'Target load test di luar cakupan.',
        };

      ctx.progress('k6: menjalankan preset');
      const result = await this.spawnK6(
        this.k6Path,
        ['run', '--quiet', '--summary-export', summaryPath, scriptPath],
        runDir,
        ctx.signal,
      );
      if (result.kind === 'cancelled')
        return {
          status: 'ERROR',
          errorCode: 'CANCELLED',
          errorMessageSafe: 'Load test dibatalkan.',
        };
      if (result.kind === 'timeout')
        return {
          status: 'ERROR',
          errorCode: 'TIMEOUT',
          errorMessageSafe: 'Load test melewati batas waktu.',
          retryable: false,
          toolName: K6_TOOL,
          toolVersion,
        };

      let summaryText: string;
      try {
        if (statSync(summaryPath).size > K6_LIMITS.summaryMaxBytes) throw new Error('too-large');
        summaryText = readFileSync(summaryPath, 'utf8');
      } catch {
        return {
          status: 'ERROR',
          errorCode: 'TOOL_FAILED',
          errorMessageSafe: 'k6 tidak menghasilkan ringkasan.',
          toolName: K6_TOOL,
          toolVersion,
        };
      }
      let summary: ReturnType<typeof parseK6Summary>;
      try {
        summary = parseK6Summary(summaryText);
      } catch {
        return {
          status: 'ERROR',
          errorCode: 'TOOL_FAILED',
          errorMessageSafe: 'Ringkasan k6 tidak valid.',
          toolName: K6_TOOL,
          toolVersion,
        };
      }

      const metrics: Record<string, number> = {
        vus: config.vus,
        ratePerSec: config.ratePerSec,
        durationSec: config.durationSec,
        plannedRequests: config.ratePerSec * config.durationSec,
      };
      if (summary.requests !== null) metrics['observedRequests'] = summary.requests;
      if (summary.failedRate !== null) metrics['failedRate'] = summary.failedRate;
      if (summary.p95Ms !== null) metrics['p95Ms'] = summary.p95Ms;

      if (result.kind === 'exit' && result.code === 0) {
        return { status: 'PASS', metrics, toolName: K6_TOOL, toolVersion };
      }
      if (result.kind === 'exit' && result.code === 99) {
        // Threshold gagal: ini hasil ukuran, bukan error tool.
        return { status: 'FAIL', metrics, toolName: K6_TOOL, toolVersion };
      }
      return {
        status: 'ERROR',
        errorCode: 'TOOL_FAILED',
        errorMessageSafe: 'k6 keluar dengan kegagalan.',
        toolName: K6_TOOL,
        toolVersion,
      };
    } finally {
      rmSync(runDir, { recursive: true, force: true });
    }
  }

  private spawnK6(
    bin: string,
    args: string[],
    cwd: string,
    signal: AbortSignal,
  ): Promise<{ kind: 'exit'; code: number } | { kind: 'cancelled' } | { kind: 'timeout' }> {
    return new Promise((resolve) => {
      let child: ChildProcess;
      try {
        // Argumen terstruktur, tanpa shell. Lingkungan minimal.
        child = this.spawnFn(bin, args, {
          cwd,
          env: safeEnv(),
          shell: false,
          stdio: ['ignore', 'ignore', 'ignore'],
        });
      } catch {
        resolve({ kind: 'exit', code: -1 });
        return;
      }
      let settled = false;
      const finish = (
        v: { kind: 'exit'; code: number } | { kind: 'cancelled' } | { kind: 'timeout' },
      ) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        resolve(v);
      };
      const kill = () => {
        child.kill('SIGTERM');
        setTimeout(() => child.kill('SIGKILL'), 2_000).unref();
      };
      const onAbort = () => {
        kill();
        finish({ kind: 'cancelled' });
      };
      const timer = setTimeout(() => {
        kill();
        finish({ kind: 'timeout' });
      }, this.timeoutMs);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      child.on('error', () => finish({ kind: 'exit', code: -1 }));
      child.on('exit', (code) => finish({ kind: 'exit', code: code ?? -1 }));
    });
  }
}

function unavailable(): ModuleOutcome {
  return {
    status: 'UNAVAILABLE',
    errorCode: 'TOOL_MISSING',
    errorMessageSafe: 'Executable k6 tidak ditemukan. Atur K6_BIN ke path binary k6.',
    skippedReason: 'k6-not-installed',
    toolName: K6_TOOL,
    toolVersion: null,
  };
}

function isExecutableFile(p: string): boolean {
  try {
    const st = statSync(p);
    return st.isFile() && (st.mode & 0o111) !== 0;
  } catch {
    return false;
  }
}

/** Lingkungan minimal untuk child process; tidak meneruskan variabel rahasia. Telemetri k6 dimatikan. */
export function safeEnv(): NodeJS.ProcessEnv {
  return {
    PATH: '/usr/local/bin:/usr/bin:/bin',
    K6_NO_USAGE_REPORT: 'true',
    K6_NO_TELEMETRY: 'true',
    HOME: tmpdir(),
    LANG: 'C.UTF-8',
  };
}

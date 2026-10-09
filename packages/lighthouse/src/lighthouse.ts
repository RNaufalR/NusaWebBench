import { existsSync } from 'node:fs';
import {
  AppError,
  checkUrlInScope,
  redactText,
  type ModuleErrorCode,
  type ScopeGrant,
} from '@nusawebbench/core';
import type { ModuleAdapter, ModuleContext, ModuleOutcome } from '@nusawebbench/orchestrator';
import type { ArtifactStore } from '@nusawebbench/storage';
import { z } from 'zod';

/**
 * Adapter Lighthouse (taskbook T-090).
 *
 * - Lighthouse dipanggil lewat API Node `lighthouse(url, flags)` dengan Chrome dari `chrome-launcher`.
 * - Argumen Chrome disusun sebagai array terstruktur. Tidak ada string shell.
 * - Chrome hanya boleh me-resolve loopback (`--host-resolver-rules`); Lighthouse tidak memiliki route
 *   guard seperti FUNCTIONAL_QA, sehingga pembatasan jaringan dilakukan di level Chrome.
 * - Output divalidasi ukuran dan skemanya sebelum dibaca. Skor yang tidak ada tidak pernah dicatat 0.
 * - Status modul menyatakan keberhasilan eksekusi dan validasi, BUKAN ambang skor.
 */

export const LIGHTHOUSE_TOOL = 'lighthouse';
export const LIGHTHOUSE_PACKAGE_VERSION = '13.5.0';
/** Tanggal verifikasi dokumentasi resmi (lihat IMPLEMENTATION_STATUS.md T-090). */
export const LIGHTHOUSE_DOCS_VERIFIED_ON = '2026-10-09';

const CATEGORY_IDS = ['performance', 'accessibility', 'best-practices', 'seo'] as const;

export const LighthouseConfigSchema = z.strictObject({
  startPath: z
    .string()
    .max(200)
    .regex(/^\/(?!\/)[^\\]*$/, { message: 'invalid-start-path' })
    .default('/'),
  formFactor: z.enum(['desktop', 'mobile']).default('desktop'),
  categories: z.array(z.enum(CATEGORY_IDS)).min(1).max(4).default(['performance', 'accessibility']),
  maxReportBytes: z.number().int().min(10_000).max(5_000_000).default(3_000_000),
});
export type LighthouseConfig = z.infer<typeof LighthouseConfigSchema>;

export function parseLighthouseConfig(raw: unknown): LighthouseConfig {
  const parsed = LighthouseConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) {
    throw new AppError('CONFIG_INVALID', { debugDetail: 'lighthouse-config' });
  }
  return parsed.data;
}

/** Emulasi layar yang dikirim ke Lighthouse. Nilai ini dicatat ulang dari konfigurasi yang dikirim. */
export const SCREEN_EMULATION = Object.freeze({
  desktop: { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1, disabled: false },
  mobile: { mobile: true, width: 412, height: 823, deviceScaleFactor: 1.75, disabled: false },
});

export const CHROME_FLAGS = Object.freeze([
  '--headless=new',
  // Diperlukan di lingkungan container/sandbox tanpa user namespace. Lihat risk register (T-090).
  '--no-sandbox',
  '--disable-gpu',
  '--disable-dev-shm-usage',
  '--disable-background-networking',
  // Hanya loopback yang dapat di-resolve; host lain gagal sebelum koneksi keluar.
  '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost',
]);

export type LighthouseRunInput = {
  readonly url: string;
  readonly chromePath: string;
  readonly settings: Readonly<Record<string, unknown>>;
  readonly onlyCategories: readonly string[];
  readonly signal: AbortSignal;
};

/** Menjalankan Lighthouse dan mengembalikan objek LHR mentah (belum divalidasi). */
export type LighthouseRunner = (input: LighthouseRunInput) => Promise<unknown>;

/** Runner default: Chrome dari chrome-launcher, Lighthouse dari paket resmi. Selalu menutup Chrome. */
export const defaultLighthouseRunner: LighthouseRunner = async (input) => {
  const { launch } = await import('chrome-launcher');
  const { default: lighthouse } = await import('lighthouse');
  const chrome = await launch({ chromePath: input.chromePath, chromeFlags: [...CHROME_FLAGS] });
  // Pembatalan atau timeout mematikan Chrome; Lighthouse lalu gagal dan runner membersihkan proses.
  const onAbort = (): void => {
    void Promise.resolve(chrome.kill()).catch(() => undefined);
  };
  input.signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (input.signal.aborted) throw new AppError('CANCELLED');
    const result = await lighthouse(
      input.url,
      {
        ...input.settings,
        port: chrome.port,
        output: 'json',
        logLevel: 'error',
        onlyCategories: [...input.onlyCategories],
      },
      undefined,
    );
    return result?.lhr;
  } finally {
    input.signal.removeEventListener('abort', onAbort);
    await Promise.resolve(chrome.kill()).catch(() => undefined);
  }
};

const ScoreSchema = z.number().finite().min(0).max(1).nullable();

/** Skema minimal keluaran LHR yang dibaca. Bidang lain dibiarkan (passthrough) dan tidak dipakai. */
export const LhrSchema = z
  .object({
    lighthouseVersion: z.string().regex(/^\d+\.\d+\.\d+/),
    requestedUrl: z.string().max(2048),
    finalDisplayedUrl: z.string().max(2048).optional(),
    finalUrl: z.string().max(2048),
    runtimeError: z
      .object({ code: z.string().max(100) })
      .nullable()
      .optional(),
    configSettings: z
      .object({
        formFactor: z.enum(['desktop', 'mobile']),
        throttlingMethod: z.string().max(50).optional(),
      })
      .passthrough(),
    environment: z
      .object({
        hostUserAgent: z.string().max(500).optional(),
      })
      .passthrough()
      .optional(),
    timing: z
      .object({ total: z.number().finite().min(0).optional() })
      .passthrough()
      .optional(),
    categories: z.record(
      z.string().max(64),
      z.object({ id: z.string().max(64), score: ScoreSchema }).passthrough(),
    ),
    audits: z.record(
      z.string().max(120),
      z
        .object({
          numericValue: z.number().finite().nullable().optional(),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type Lhr = z.infer<typeof LhrSchema>;

/** Audit yang metriknya dicatat bila tersedia. Tidak ada nilai default. */
const METRIC_AUDITS: Readonly<Record<string, string>> = Object.freeze({
  'first-contentful-paint': 'fcp_ms',
  'largest-contentful-paint': 'lcp_ms',
  'total-blocking-time': 'tbt_ms',
  'speed-index': 'speed_index_ms',
  'cumulative-layout-shift': 'cls',
});

export type ComparabilityCheck = {
  readonly comparable: boolean;
  readonly reasons: readonly string[];
};

/**
 * Menentukan apakah hasil bisa dibandingkan dengan run lain. Perbedaan form factor, throttling,
 * atau origin akhir membuat hasil tidak comparable.
 */
export function comparability(
  requested: LighthouseConfig,
  lhr: Lhr,
  grant: ScopeGrant,
): ComparabilityCheck {
  const reasons: string[] = [];
  if (lhr.configSettings.formFactor !== requested.formFactor) reasons.push('form-factor-differs');
  if (
    lhr.configSettings.throttlingMethod !== undefined &&
    lhr.configSettings.throttlingMethod !== 'simulate'
  ) {
    reasons.push('throttling-differs');
  }
  let finalOrigin: string | null = null;
  try {
    finalOrigin = new URL(lhr.finalUrl).origin;
  } catch {
    finalOrigin = null;
  }
  if (finalOrigin !== grant.origin) reasons.push('final-origin-differs');
  return { comparable: reasons.length === 0, reasons };
}

/** Redaksi rekursif untuk laporan mentah sebelum disimpan sebagai artefak. */
function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[redactText(k)] = redactDeep(v);
    return out;
  }
  return value;
}

function browserVersionOf(lhr: Lhr): string | null {
  const ua = lhr.environment?.hostUserAgent ?? '';
  const m = /Chrom(?:e|ium)\/(\d+\.\d+\.\d+\.\d+)/.exec(ua);
  return m?.[1] ?? null;
}

export type LighthouseAdapterOptions = {
  readonly artifacts: ArtifactStore;
  readonly config?: unknown;
  readonly executablePath?: string | undefined;
  readonly runner?: LighthouseRunner;
  readonly now?: () => Date;
  /** Batas waktu modul di orchestrator. Default 150 detik. */
  readonly timeoutMs?: number;
};

export class LighthouseAdapter implements ModuleAdapter {
  readonly module = 'LIGHTHOUSE' as const;
  readonly required = false;
  readonly timeoutMs: number;
  readonly maxRetries = 0;

  private readonly artifacts: ArtifactStore;
  private readonly rawConfig: unknown;
  private readonly executablePath: string | undefined;
  private readonly runner: LighthouseRunner;

  constructor(options: LighthouseAdapterOptions) {
    this.artifacts = options.artifacts;
    this.rawConfig = options.config ?? {};
    this.executablePath = options.executablePath ?? process.env['CHROMIUM_PATH'] ?? undefined;
    this.runner = options.runner ?? defaultLighthouseRunner;
    this.timeoutMs = options.timeoutMs ?? 150_000;
  }

  async run(ctx: ModuleContext): Promise<ModuleOutcome> {
    let config: LighthouseConfig;
    try {
      config = parseLighthouseConfig(this.rawConfig);
    } catch {
      return {
        status: 'ERROR',
        errorCode: 'CONFIG_INVALID',
        errorMessageSafe: 'Konfigurasi Lighthouse tidak valid.',
      };
    }

    // Eksekutabel dicek sebelum apa pun dijalankan.
    if (this.executablePath === undefined || !existsSync(this.executablePath)) {
      return unavailable('TOOL_MISSING', 'Chromium untuk Lighthouse tidak ditemukan.');
    }

    // Target awal harus berada dalam scope. Redirect setelah load dicek lewat finalUrl.
    const startUrl = new URL(config.startPath, ctx.grant.origin).href;
    const decision = await checkUrlInScope(startUrl, ctx.grant);
    if (!decision.allowed) {
      return {
        status: 'ERROR',
        errorCode: 'SCOPE_DENIED',
        errorMessageSafe: 'Target Lighthouse berada di luar cakupan.',
      };
    }
    if (ctx.signal.aborted) {
      return { status: 'ERROR', errorCode: 'CANCELLED', errorMessageSafe: 'Run dibatalkan.' };
    }

    const settings = {
      formFactor: config.formFactor,
      screenEmulation: SCREEN_EMULATION[config.formFactor],
      throttlingMethod: 'simulate',
    };
    const innerController = new AbortController();
    const onAbort = (): void => innerController.abort();
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    let raw: unknown;
    try {
      ctx.progress('lighthouse: mulai');
      raw = await this.raceWithLimit(
        ctx.signal,
        this.runner({
          url: startUrl,
          chromePath: this.executablePath,
          settings,
          onlyCategories: config.categories,
          signal: innerController.signal,
        }),
        this.timeoutMs,
        innerController,
      );
    } catch (err) {
      if (ctx.signal.aborted) {
        return { status: 'ERROR', errorCode: 'CANCELLED', errorMessageSafe: 'Run dibatalkan.' };
      }
      if (err instanceof AppError && err.code === 'TIMEOUT') {
        return errorOutcome('TIMEOUT', 'Lighthouse melewati batas waktu.');
      }
      // Pesan asli dari Chrome/Lighthouse tidak dikembalikan (dapat memuat path lokal).
      return {
        status: 'ERROR',
        errorCode: 'TOOL_FAILED',
        errorMessageSafe: 'Lighthouse gagal dijalankan (browser atau tool).',
      };
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }
    ctx.progress('lighthouse: validasi keluaran');

    // Validasi ukuran sebelum parsing. Laporan di atas batas ditolak, tidak dipotong diam-diam.
    const rawJson = safeStringify(raw);
    if (rawJson === null || Buffer.byteLength(rawJson, 'utf8') > config.maxReportBytes) {
      return {
        status: 'ERROR',
        errorCode: 'TOOL_FAILED',
        errorMessageSafe: 'Keluaran Lighthouse tidak valid atau terlalu besar.',
      };
    }
    const parsed = LhrSchema.safeParse(JSON.parse(rawJson));
    if (!parsed.success) {
      return {
        status: 'ERROR',
        errorCode: 'TOOL_FAILED',
        errorMessageSafe: 'Keluaran Lighthouse tidak sesuai skema yang didukung.',
      };
    }
    const lhr = parsed.data;
    if (lhr.runtimeError) {
      return {
        status: 'ERROR',
        errorCode: 'TOOL_FAILED',
        errorMessageSafe: `Lighthouse melaporkan runtime error (${redactText(lhr.runtimeError.code)}).`,
      };
    }
    const check = comparability(config, lhr, ctx.grant);
    if (check.reasons.includes('final-origin-differs')) {
      return {
        status: 'ERROR',
        errorCode: 'SCOPE_DENIED',
        errorMessageSafe: 'Halaman berakhir di luar cakupan (redirect).',
      };
    }

    const metrics: Record<string, number> = { comparable: check.comparable ? 1 : 0 };
    for (const id of CATEGORY_IDS) {
      const cat = lhr.categories[id];
      if (cat && cat.score !== null && cat.score !== undefined) {
        metrics[`score_${id.replace(/-/g, '_')}`] = Math.round(cat.score * 100);
      }
    }
    for (const [auditId, metricName] of Object.entries(METRIC_AUDITS)) {
      const v = lhr.audits[auditId]?.numericValue;
      if (typeof v === 'number' && Number.isFinite(v)) metrics[metricName] = v;
    }
    const total = lhr.timing?.total;
    if (typeof total === 'number' && Number.isFinite(total))
      metrics['lighthouse_duration_ms'] = total;

    const artifactRefs: string[] = [];
    const artifactId = this.saveRawSanitized(ctx, lhr, rawJson, metrics);
    if (artifactId !== null) artifactRefs.push(artifactId);

    const browser = browserVersionOf(lhr);
    return {
      status: 'PASS',
      metrics,
      findings: [],
      artifactRefs,
      toolName: LIGHTHOUSE_TOOL,
      toolVersion: `${lhr.lighthouseVersion}${browser ? `; chrome ${browser}` : ''}`.slice(0, 100),
      errorCode: null,
      errorMessageSafe: null,
    };
  }

  /** Menyimpan laporan mentah yang sudah diredaksi sebagai artefak JSON. */
  private saveRawSanitized(
    ctx: ModuleContext,
    lhr: Lhr,
    rawJson: string,
    metrics: Record<string, number>,
  ): string | null {
    const body = JSON.stringify(redactDeep(JSON.parse(rawJson)));
    try {
      const ev = this.artifacts.write({
        runId: ctx.runId,
        kind: 'json',
        mimeType: 'application/json',
        bytes: Buffer.from(body, 'utf8'),
        sourceTool: LIGHTHOUSE_TOOL,
        sourceVersion: lhr.lighthouseVersion,
        description: 'Laporan Lighthouse mentah (diredaksi)',
        redactionApplied: true,
        synthetic: ctx.grant.mode === 'local-fixture',
      });
      return ev.id;
    } catch {
      metrics['artifact_saved'] = 0;
      return null;
    }
  }

  /**
   * Menunggu runner dengan dua pembatas: batas waktu modul dan pembatalan run. Keduanya menghentikan
   * sinyal runner. Runner yang macet tidak boleh menggantungkan adapter.
   */
  private async raceWithLimit(
    runSignal: AbortSignal,
    promise: Promise<unknown>,
    limitMs: number,
    controller: AbortController,
  ): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const limit = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new AppError('TIMEOUT'));
      }, limitMs);
    });
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => {
        controller.abort();
        reject(new AppError('CANCELLED'));
      };
      if (runSignal.aborted) onAbort();
      else runSignal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      return await Promise.race([promise, limit, cancelled]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort !== undefined) runSignal.removeEventListener('abort', onAbort);
    }
  }
}

function unavailable(code: ModuleErrorCode, message: string): ModuleOutcome {
  return { status: 'UNAVAILABLE', errorCode: code, errorMessageSafe: message };
}

function errorOutcome(code: ModuleErrorCode, message: string): ModuleOutcome {
  return { status: 'ERROR', errorCode: code, errorMessageSafe: message };
}

function safeStringify(value: unknown): string | null {
  try {
    const s = JSON.stringify(value);
    return typeof s === 'string' ? s : null;
  } catch {
    return null;
  }
}

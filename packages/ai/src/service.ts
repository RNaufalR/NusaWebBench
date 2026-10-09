import {
  AI_TASK_TYPES,
  createProviderUsage,
  newId,
  redactText,
  type AiTaskType,
  type AppConfig,
  type Provider,
  type Verification,
} from '@nusawebbench/core';
import type { Store } from '@nusawebbench/storage';
import { ProviderCallError, type AiErrorKind } from './errors.js';
import { BudgetGuard, bucketOf } from './guard.js';
import {
  MODEL_REGISTRY,
  TASK_REQUIREMENTS,
  findModel,
  satisfies,
  type ModelEntry,
} from './registry.js';
import type { ProviderClient, ProviderImage } from './providers.js';

/** Batas input sebelum request dikirim (taskbook T-110 instruksi 4). */
export const MAX_PROMPT_CHARS = 8_000;
export const MAX_OUTPUT_CHARS = 16_000;
export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp'] as const;
export const SETTINGS_KEYS = {
  consent: 'ai.external_data_consent',
  consentAt: 'ai.external_data_consent_at',
  counterResetAt: 'ai.counter_reset_at',
  redaction: 'ai.redaction_level',
} as const;

export type AiUnavailableReason =
  | 'provider-disabled'
  | 'operator-external-data-disabled'
  | 'consent-missing'
  | 'free-tier-lock'
  | 'provider-key-missing'
  | 'model-not-configured'
  | 'model-not-allowlisted'
  | 'capability-mismatch'
  | 'input-too-long'
  | 'image-invalid'
  | 'run-quota-exhausted'
  | 'local-quota-exhausted'
  | 'provider-failed'
  | 'cancelled';

export type AiImageInput = { readonly mime: string; readonly data: Buffer };

export type AiRequest = {
  readonly task: AiTaskType;
  readonly prompt: string;
  readonly images?: readonly AiImageInput[];
  readonly runId?: string | null;
  /** Pembatalan dari run pemanggil. */
  readonly signal?: AbortSignal;
};

export type AiOutcome =
  | {
      readonly status: 'OK';
      readonly text: string;
      readonly provider: Provider;
      readonly model: string;
      readonly fallbackReason: string | null;
      readonly attempts: number;
      readonly inputTokens: number | null;
      readonly outputTokens: number | null;
      /** Estimasi lokal, selalu diberi label terpisah dari angka provider. */
      readonly estimatedTokens: number;
    }
  | {
      readonly status: 'AI_UNAVAILABLE';
      readonly reason: AiUnavailableReason;
      readonly errorKind: AiErrorKind | null;
      readonly retryAfterSec: number | null;
    };

export type AiServiceOptions = {
  readonly store: Store;
  readonly config: AppConfig;
  readonly clients: Partial<Record<Provider, ProviderClient>>;
  readonly registry?: readonly ModelEntry[];
  readonly now?: () => Date;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly guard?: BudgetGuard;
};

/** Hasil klasifikasi kegagalan untuk pemetaan ke AI_UNAVAILABLE dan status usage. */
function usageStatusFor(kind: AiErrorKind): 'RATE_LIMITED' | 'UNAVAILABLE' | 'ERROR' {
  if (kind === 'RATE_LIMITED') return 'RATE_LIMITED';
  if (kind === 'MODEL_UNAVAILABLE') return 'UNAVAILABLE';
  return 'ERROR';
}

/**
 * Satu-satunya jalur pemanggilan provider AI. Urutan pemeriksaan: opt-in provider, izin operator,
 * consent pengguna, free-tier lock, routing, validasi input, budget guard, panggilan (dengan retry
 * terbatas), validasi output, lalu pencatatan usage.
 */
export class AiService {
  private readonly store: Store;
  private readonly config: AppConfig;
  private readonly clients: Partial<Record<Provider, ProviderClient>>;
  private readonly registry: readonly ModelEntry[];
  private readonly now: () => Date;
  private readonly sleep: (ms: number) => Promise<void>;
  readonly guard: BudgetGuard;
  private readonly perRun = new Map<string, number>();

  constructor(options: AiServiceOptions) {
    this.store = options.store;
    this.config = options.config;
    this.clients = options.clients;
    this.registry = options.registry ?? MODEL_REGISTRY;
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.guard =
      options.guard ??
      new BudgetGuard(this.store, this.now, () => {
        const v = this.store.settings.get(SETTINGS_KEYS.counterResetAt);
        return typeof v === 'string' ? v : null;
      });
  }

  /** Urutan provider yang boleh dicoba. Fallback hanya bila diaktifkan operator. */
  private candidateProviders(): Provider[] {
    const primary: Provider | null =
      this.config.AI_PROVIDER === 'gemini' || this.config.AI_PROVIDER === 'auto'
        ? 'gemini'
        : this.config.AI_PROVIDER === 'groq'
          ? 'groq'
          : null;
    if (primary === null) return [];
    if (!this.config.AI_FALLBACK_ENABLED) return [primary];
    return primary === 'gemini' ? ['gemini', 'groq'] : ['groq', 'gemini'];
  }

  private modelFor(provider: Provider): string {
    return provider === 'gemini' ? this.config.GEMINI_MODEL : this.config.GROQ_MODEL;
  }

  private keyFor(provider: Provider): string {
    return provider === 'gemini' ? this.config.GEMINI_API_KEY : this.config.GROQ_API_KEY;
  }

  /** Memilih provider pertama yang lolos semua syarat. Mengembalikan alasan penolakan bila tidak ada. */
  route(task: AiTaskType):
    | {
        provider: Provider;
        model: string;
        fallbackReason: string | null;
        fallbackFrom: Provider | null;
      }
    | AiUnavailableReason {
    const need = TASK_REQUIREMENTS[task];
    let lastReason: AiUnavailableReason = 'provider-disabled';
    const candidates = this.candidateProviders();
    for (const [index, provider] of candidates.entries()) {
      const model = this.modelFor(provider).trim();
      if (model === '') {
        lastReason = 'model-not-configured';
        continue;
      }
      const entry = findModel(this.registry, provider, model);
      if (!entry) {
        lastReason = 'model-not-allowlisted';
        continue;
      }
      if (this.config.FREE_TIER_LOCK && !entry.freeTierAllowlisted) {
        lastReason = 'free-tier-lock';
        continue;
      }
      if (!satisfies(entry.capabilities, need)) {
        lastReason = 'capability-mismatch';
        continue;
      }
      if (this.keyFor(provider) === '' || !this.clients[provider]) {
        lastReason = 'provider-key-missing';
        continue;
      }
      const fallbackFrom = index === 0 ? null : (candidates[0] ?? null);
      const fallbackReason = fallbackFrom === null ? null : `primary-unavailable:${fallbackFrom}`;
      return { provider, model, fallbackReason, fallbackFrom };
    }
    return lastReason;
  }

  private unavailable(
    reason: AiUnavailableReason,
    errorKind: AiErrorKind | null = null,
    retryAfterSec: number | null = null,
  ): AiOutcome {
    return { status: 'AI_UNAVAILABLE', reason, errorKind, retryAfterSec };
  }

  private validateImages(images: readonly AiImageInput[]): boolean {
    if (images.length > 3) return false;
    return images.every(
      (img) =>
        (ALLOWED_IMAGE_MIME as readonly string[]).includes(img.mime) &&
        img.data.byteLength > 0 &&
        img.data.byteLength <= 1_500_000,
    );
  }

  async run(req: AiRequest): Promise<AiOutcome> {
    if (this.config.AI_PROVIDER === 'none') return this.unavailable('provider-disabled');
    if (!this.config.AI_ALLOW_EXTERNAL_DATA)
      return this.unavailable('operator-external-data-disabled');
    if (this.store.settings.get(SETTINGS_KEYS.consent) !== true)
      return this.unavailable('consent-missing');
    if (!(AI_TASK_TYPES as readonly string[]).includes(req.task))
      return this.unavailable('capability-mismatch');

    const routed = this.route(req.task);
    if (typeof routed === 'string') return this.unavailable(routed);

    if (req.prompt.length > MAX_PROMPT_CHARS) return this.unavailable('input-too-long');
    const images = req.images ?? [];
    if (images.length > 0 && !this.validateImages(images)) return this.unavailable('image-invalid');
    if (TASK_REQUIREMENTS[req.task].image && images.length === 0)
      return this.unavailable('image-invalid');

    // Redaksi sebelum data keluar dari proses (taskbook T-110 instruksi 6).
    const prompt = redactText(req.prompt);
    const runKey = req.runId ?? null;
    const runCap = this.config.AI_MAX_REQUESTS_PER_RUN;
    const maxAttempts = 1 + Math.min(this.config.AI_MAX_RETRIES, 2);
    const client = this.clients[routed.provider];
    if (!client) return this.unavailable('provider-key-missing');

    let attempts = 0;
    let lastError: ProviderCallError | null = null;
    while (attempts < maxAttempts) {
      if (req.signal?.aborted) return this.unavailable('cancelled');
      if (runKey !== null && (this.perRun.get(runKey) ?? 0) >= runCap) {
        return this.unavailable('run-quota-exhausted');
      }
      const reservation = this.guard.reserve(routed.provider, this.config.AI_MAX_REQUESTS_PER_DAY);
      if (reservation === null) return this.unavailable('local-quota-exhausted');
      attempts += 1;
      if (runKey !== null) this.perRun.set(runKey, (this.perRun.get(runKey) ?? 0) + 1);

      const started = this.now().getTime();
      try {
        const res = await client.generate({
          model: routed.model,
          prompt,
          images: images.map((i): ProviderImage => ({ mime: i.mime, data: i.data })),
          maxOutputTokens: this.config.AI_MAX_OUTPUT_TOKENS,
          timeoutMs: this.config.AI_REQUEST_TIMEOUT_MS,
          signal: req.signal ?? new AbortController().signal,
        });
        const durationMs = this.now().getTime() - started;
        if (res.text.length > MAX_OUTPUT_CHARS) {
          throw new ProviderCallError('INVALID_RESPONSE', false);
        }
        this.recordUsage(
          req,
          routed.provider,
          routed.model,
          'OK',
          durationMs,
          res.inputTokens,
          res.outputTokens,
          prompt.length + res.text.length,
          runKey,
          null,
          routed.fallbackFrom,
        );
        reservation.release();
        return {
          status: 'OK',
          text: res.text,
          provider: routed.provider,
          model: routed.model,
          fallbackReason: routed.fallbackReason,
          attempts,
          inputTokens: res.inputTokens,
          outputTokens: res.outputTokens,
          estimatedTokens: Math.ceil((prompt.length + res.text.length) / 4),
        };
      } catch (err) {
        reservation.release();
        const durationMs = this.now().getTime() - started;
        const pce =
          err instanceof ProviderCallError ? err : new ProviderCallError('UNKNOWN', false);
        lastError = pce;
        this.recordUsage(
          req,
          routed.provider,
          routed.model,
          usageStatusFor(pce.kind),
          durationMs,
          null,
          null,
          prompt.length,
          runKey,
          pce.kind,
          routed.fallbackFrom,
        );
        if (!pce.retryable || attempts >= maxAttempts) break;
        await this.sleep(300 * attempts);
      }
    }
    const kind = lastError?.kind ?? 'UNKNOWN';
    return this.unavailable('provider-failed', kind, lastError?.retryAfterSec ?? null);
  }

  /**
   * Uji koneksi manual (taskbook T-180): satu request kecil, hanya dipanggil atas aksi pengguna.
   * Tetap melewati semua gerbang dan budget guard yang sama dengan panggilan biasa.
   */
  testConnection(): Promise<AiOutcome> {
    return this.run({ task: 'TEXT_SUMMARY', prompt: 'Balas dengan satu kata: ok.' });
  }

  private recordUsage(
    req: AiRequest,
    provider: Provider,
    modelId: string,
    status: 'OK' | 'ERROR' | 'RATE_LIMITED' | 'UNAVAILABLE',
    durationMs: number,
    inputTokens: number | null,
    outputTokens: number | null,
    chars: number,
    runId: string | null,
    errorCode: AiErrorKind | null,
    fallbackFrom: Provider | null,
  ): void {
    const now = this.now();
    const usage = createProviderUsage({
      id: newId('usage'),
      runId: runId !== null && /^run_[A-Za-z0-9_-]{8,64}$/.test(runId) ? runId : null,
      provider,
      modelId,
      taskType: req.task,
      requestCount: 1,
      status,
      durationMs: Math.max(0, Math.min(durationMs, 3_600_000)),
      inputTokens: inputTokens ?? null,
      outputTokens: outputTokens ?? null,
      estimatedTokens: Math.ceil(chars / 4),
      estimatedCost: null,
      localQuotaBucket: bucketOf(now),
      recordedAt: now.toISOString(),
      errorCode,
      fallbackFrom,
    });
    this.store.usage.insert(usage);
  }
}

/** Temuan yang dibuat dari output AI tidak boleh berstatus CONFIRMED (taskbook §8.3 dan T-130). */
export function aiFindingVerification(v: Verification): Verification {
  return v === 'CONFIRMED' ? 'LIKELY' : v;
}

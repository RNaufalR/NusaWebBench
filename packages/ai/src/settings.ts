import { z } from 'zod';
import { AppError, type AppConfig, type Provider } from '@nusawebbench/core';
import type { Store } from '@nusawebbench/storage';
import { bucketOf } from './guard.js';
import { MODEL_REGISTRY, isStale, type ModelEntry } from './registry.js';
import { SETTINGS_KEYS } from './service.js';

/**
 * Pengaturan AI dan penggunaan lokal (taskbook T-180). Rahasia (API key) TIDAK PERNAH dikembalikan:
 * status hanya memuat `keyConfigured`. Pengaturan yang dapat diubah lewat API bersifat terbatas;
 * FREE_TIER_LOCK, provider, dan izin operator hanya berasal dari environment.
 */

/** Pembaruan yang diizinkan. Kunci lain (mis. freeTierLock, provider) ditolak oleh schema strict. */
export const SettingsUpdateSchema = z.strictObject({
  externalDataConsent: z.boolean().optional(),
  redactionLevel: z.enum(['standard', 'strict']).optional(),
});
export type SettingsUpdate = z.infer<typeof SettingsUpdateSchema>;

export function parseSettingsUpdate(input: unknown): SettingsUpdate {
  const parsed = SettingsUpdateSchema.safeParse(input);
  if (!parsed.success)
    throw new AppError('VALIDATION_FAILED', { safeMessage: 'Pengaturan AI tidak valid.' });
  return parsed.data;
}

export class AiSettingsService {
  constructor(
    private readonly store: Store,
    private readonly config: AppConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Mengubah consent. Mencabut consent berlaku segera untuk semua pemanggilan berikutnya. */
  update(input: SettingsUpdate): void {
    if (input.externalDataConsent !== undefined) {
      this.store.settings.set(SETTINGS_KEYS.consent, input.externalDataConsent, this.now());
      this.store.settings.set(
        SETTINGS_KEYS.consentAt,
        input.externalDataConsent ? this.now().toISOString() : null,
        this.now(),
      );
    }
    if (input.redactionLevel !== undefined) {
      this.store.settings.set(SETTINGS_KEYS.redaction, input.redactionLevel, this.now());
    }
  }

  /** Reset penghitung lokal. Riwayat tetap tersimpan; ini TIDAK mereset kuota provider. */
  resetLocalCounters(): void {
    this.store.settings.set(SETTINGS_KEYS.counterResetAt, this.now().toISOString(), this.now());
  }

  status(): {
    operator: {
      provider: string;
      freeTierLock: boolean;
      fallbackEnabled: boolean;
      allowExternalData: boolean;
    };
    consent: { externalDataConsent: boolean; consentAt: string | null; redactionLevel: string };
    providers: Array<{
      provider: Provider;
      keyConfigured: boolean;
      model: string;
      allowlisted: boolean;
      capabilities: ModelEntry['capabilities'] | null;
      verifiedOn: string | null;
      stale: boolean;
      localRequestsToday: number;
      localDailyCap: number;
    }>;
    notices: string[];
  } {
    const now = this.now();
    const bucket = bucketOf(now);
    const resetAt = this.store.settings.get(SETTINGS_KEYS.counterResetAt);
    const baseline = typeof resetAt === 'string' ? resetAt : null;
    const providers: Provider[] = ['gemini', 'groq'];
    const notices: string[] = [
      'Penghitung ini hanya penggunaan aplikasi lokal. Mereset penghitung lokal tidak mereset kuota provider.',
      'Data yang dikirim ke provider (teks, screenshot, log, atau kode) meninggalkan mesin ini. Aktifkan hanya bila Anda memahami kebijakan data provider.',
    ];
    const rows = providers.map((provider) => {
      const model = provider === 'gemini' ? this.config.GEMINI_MODEL : this.config.GROQ_MODEL;
      const entry = MODEL_REGISTRY.find((m) => m.provider === provider && m.model === model.trim());
      const stale = entry ? isStale(entry.verifiedOn, now) : false;
      if (entry && stale)
        notices.push(`Verifikasi model ${entry.model} sudah usang (${entry.verifiedOn}).`);
      return {
        provider,
        keyConfigured:
          (provider === 'gemini' ? this.config.GEMINI_API_KEY : this.config.GROQ_API_KEY) !== '',
        model,
        allowlisted: entry !== undefined,
        capabilities: entry ? entry.capabilities : null,
        verifiedOn: entry ? entry.verifiedOn : null,
        stale,
        localRequestsToday: this.store.usage.countRequestsSince(provider, bucket, baseline),
        localDailyCap: this.config.AI_MAX_REQUESTS_PER_DAY,
      };
    });
    const consent = this.store.settings.get(SETTINGS_KEYS.consent) === true;
    const consentAt = this.store.settings.get(SETTINGS_KEYS.consentAt);
    const redaction = this.store.settings.get(SETTINGS_KEYS.redaction);
    return {
      operator: {
        provider: this.config.AI_PROVIDER,
        freeTierLock: this.config.FREE_TIER_LOCK,
        fallbackEnabled: this.config.AI_FALLBACK_ENABLED,
        allowExternalData: this.config.AI_ALLOW_EXTERNAL_DATA,
      },
      consent: {
        externalDataConsent: consent,
        consentAt: typeof consentAt === 'string' ? consentAt : null,
        redactionLevel: typeof redaction === 'string' ? redaction : 'standard',
      },
      providers: rows,
      notices,
    };
  }
}

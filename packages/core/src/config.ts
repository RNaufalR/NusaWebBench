import { z } from 'zod';
import { AppError } from './errors.js';

/**
 * Konfigurasi server dari environment (taskbook §2.3). Divalidasi saat startup.
 * Pesan error hanya menyebut nama variabel dan alasan; nilai (terutama secret) tidak pernah ditampilkan.
 */

/** Variabel kosong (`NAME=`) diperlakukan sama dengan tidak di-set: memakai default. */
const emptyToUndefined = (value: unknown): unknown => (value === '' ? undefined : value);

const boolFlag = (defaultValue: boolean) =>
  z.preprocess(
    emptyToUndefined,
    z
      .enum(['true', 'false'])
      .default(defaultValue ? 'true' : 'false')
      .transform((v) => v === 'true'),
  );

const intInRange = (min: number, max: number, defaultValue: number) =>
  z.preprocess(emptyToUndefined, z.coerce.number().int().min(min).max(max).default(defaultValue));

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1']);

export const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[A-Za-z0-9.:-]+$/, { message: 'host-invalid-characters' })
      .default('127.0.0.1'),
    ALLOW_EXTERNAL_BIND: boolFlag(false),
    PORT: intInRange(1024, 65535, 4178),
    DATABASE_PATH: z.string().min(1).max(1024).default('./data/nusawebbench.sqlite'),
    ARTIFACTS_DIR: z.string().min(1).max(1024).default('./data/artifacts'),

    FREE_TIER_LOCK: boolFlag(true),
    AI_PROVIDER: z.enum(['none', 'gemini', 'groq', 'auto']).default('none'),
    AI_FALLBACK_ENABLED: boolFlag(false),
    AI_ALLOW_EXTERNAL_DATA: boolFlag(false),
    AI_MAX_REQUESTS_PER_RUN: intInRange(0, 100, 3),
    AI_MAX_REQUESTS_PER_DAY: intInRange(0, 10_000, 20),
    AI_MAX_OUTPUT_TOKENS: intInRange(1, 8192, 800),
    AI_REQUEST_TIMEOUT_MS: intInRange(1000, 120_000, 20_000),
    AI_MAX_RETRIES: intInRange(0, 3, 1),
    AI_MAX_IMAGE_BYTES: intInRange(1024, 10 * 1024 * 1024, 1_500_000),
    AI_MAX_IMAGES_PER_RUN: intInRange(0, 10, 3),

    GEMINI_API_KEY: z.string().max(512).default(''),
    GEMINI_MODEL: z
      .string()
      .max(100)
      .regex(/^[A-Za-z0-9._/:-]*$/, { message: 'model-id-invalid' })
      .default(''),
    GROQ_API_KEY: z.string().max(512).default(''),
    GROQ_MODEL: z
      .string()
      .max(100)
      .regex(/^[A-Za-z0-9._/:-]*$/, { message: 'model-id-invalid' })
      .default(''),

    STRIX_ENABLED: boolFlag(false),
    K6_ENABLED: boolFlag(false),
    LOW_RESOURCE_MODE: boolFlag(true),
  })
  .superRefine((cfg, ctx) => {
    if (!LOOPBACK_HOSTS.has(cfg.HOST) && !cfg.ALLOW_EXTERNAL_BIND) {
      ctx.addIssue({
        code: 'custom',
        path: ['HOST'],
        message: 'non-loopback-host-requires-ALLOW_EXTERNAL_BIND',
      });
    }
    if (cfg.AI_PROVIDER !== 'none' && !cfg.FREE_TIER_LOCK) {
      // Dengan lock dimatikan, provider boleh dipilih tanpa allowlist. Ini harus eksplisit.
      ctx.addIssue({
        code: 'custom',
        path: ['FREE_TIER_LOCK'],
        message: 'provider-requires-free-tier-lock',
      });
    }
    if (cfg.AI_PROVIDER === 'gemini' && cfg.GEMINI_API_KEY !== '' && cfg.GEMINI_MODEL === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['GEMINI_MODEL'],
        message: 'model-required-when-key-set',
      });
    }
    if (cfg.AI_PROVIDER === 'groq' && cfg.GROQ_API_KEY !== '' && cfg.GROQ_MODEL === '') {
      ctx.addIssue({
        code: 'custom',
        path: ['GROQ_MODEL'],
        message: 'model-required-when-key-set',
      });
    }
    if (cfg.AI_MAX_REQUESTS_PER_RUN > cfg.AI_MAX_REQUESTS_PER_DAY) {
      ctx.addIssue({
        code: 'custom',
        path: ['AI_MAX_REQUESTS_PER_RUN'],
        message: 'per-run-limit-exceeds-daily-limit',
      });
    }
  });

export type AppConfig = z.infer<typeof ConfigSchema>;

/** Kunci secret yang tidak boleh masuk snapshot, log, atau respons API. */
export const SECRET_ENV_KEYS = ['GEMINI_API_KEY', 'GROQ_API_KEY'] as const;

/**
 * Memvalidasi environment. Melempar AppError CONFIG_INVALID dengan daftar nama variabel
 * bermasalah dan alasannya — tidak pernah menyertakan nilai.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = ConfigSchema.safeParse(env);
  if (result.success) {
    return result.data;
  }
  const problems = result.error.issues
    .map((issue) => {
      const name = issue.path.map(String).join('.') || '(config)';
      return `${name} (${issue.message})`;
    })
    .join(', ');
  throw new AppError('CONFIG_INVALID', {
    safeMessage: 'Konfigurasi aplikasi tidak valid. Periksa nama variabel berikut.',
    debugDetail: problems,
  });
}

/**
 * Snapshot yang aman untuk disimpan/ditampilkan: secret diganti boolean "terkonfigurasi".
 * Hanya field tanpa secret yang disalin.
 */
export function configSnapshot(cfg: AppConfig): Record<string, string | number | boolean | null> {
  const { GEMINI_API_KEY, GROQ_API_KEY, ...rest } = cfg;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(rest)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  out['GEMINI_API_KEY_CONFIGURED'] = GEMINI_API_KEY !== '';
  out['GROQ_API_KEY_CONFIGURED'] = GROQ_API_KEY !== '';
  return out;
}

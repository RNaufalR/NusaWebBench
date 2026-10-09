import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import { AppError, checkUrlInScope } from '@nusawebbench/core';
import { MODEL_REGISTRY, findModel } from '@nusawebbench/ai';
import type { ModuleAdapter, ModuleContext, ModuleOutcome } from '@nusawebbench/orchestrator';

/**
 * Adapter Strix (SECURITY_STRIX, taskbook T-160). Pada state ini adapter hanya menjalankan GERBANG:
 * opt-in, lokal saja, preflight Docker, kunci provider, dan allowlist model. Runner pemindaian belum
 * diimplementasikan karena kontrak CLI dan format output Strix belum diverifikasi di sandbox
 * (membutuhkan Docker). Karena itu adapter TIDAK pernah menjalankan pemindaian; hasilnya selalu
 * UNAVAILABLE dengan alasan yang eksplisit setelah gerbang lolos.
 *
 * Sumber (diambil 2026-10-09): https://github.com/usestrix/strix — berjalan di container (Docker),
 * lisensi Apache-2.0, contoh model default memakai OpenRouter (bukan Gemini/Groq). Kompatibilitas
 * Gemini/Groq dengan Strix BELUM dibuktikan.
 */

export const STRIX_TOOL = 'strix';
export const STRIX_RUNNER_STATUS = 'contract-unverified' as const;
const execFileAsync = promisify(execFile);

export const StrixConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  provider: z.enum(['gemini', 'groq']).default('gemini'),
  model: z.string().min(1).max(100).default('gemini-3.8-flash'),
  maxRuntimeSec: z.number().int().min(60).max(600).default(300),
});
export type StrixConfig = z.infer<typeof StrixConfigSchema>;

export function parseStrixConfig(raw: unknown): StrixConfig {
  const parsed = StrixConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError('CONFIG_INVALID', { debugDetail: 'strix-config' });
  return parsed.data;
}

export type StrixAdapterOptions = {
  readonly config?: unknown;
  /** Path Docker CLI. Default `docker` (dari PATH). */
  readonly dockerBin?: string;
  /** Kunci provider (hanya dari environment, tidak pernah dicetak). */
  readonly providerKeys?: { readonly gemini?: string; readonly groq?: string };
  readonly registry?: typeof MODEL_REGISTRY;
};

export class StrixAdapter implements ModuleAdapter {
  readonly module = 'SECURITY_STRIX' as const;
  readonly required = false;
  readonly timeoutMs = 600_000;
  readonly maxRetries = 0;
  private readonly rawConfig: unknown;
  private readonly dockerBin: string;
  private readonly keys: { gemini?: string; groq?: string };
  private readonly registry: typeof MODEL_REGISTRY;

  constructor(options: StrixAdapterOptions = {}) {
    this.rawConfig = options.config ?? {};
    this.dockerBin = options.dockerBin ?? 'docker';
    this.keys = { ...(options.providerKeys ?? {}) };
    this.registry = options.registry ?? MODEL_REGISTRY;
  }

  async run(ctx: ModuleContext): Promise<ModuleOutcome> {
    let config: StrixConfig;
    try {
      config = parseStrixConfig(this.rawConfig);
    } catch {
      return {
        status: 'ERROR',
        errorCode: 'CONFIG_INVALID',
        errorMessageSafe: 'Konfigurasi Strix tidak valid.',
      };
    }
    // Gerbang 1: opt-in.
    if (!config.enabled) return { status: 'SKIPPED', skippedReason: 'strix-disabled' };
    // Gerbang 2: lokal saja, tidak ada pemindaian publik otomatis.
    if (ctx.grant.mode !== 'local-fixture') {
      return {
        status: 'ERROR',
        errorCode: 'SCOPE_DENIED',
        errorMessageSafe: 'Strix hanya untuk target lokal.',
      };
    }
    const scope = await checkUrlInScope(ctx.grant.origin, ctx.grant);
    if (!scope.allowed)
      return {
        status: 'ERROR',
        errorCode: 'SCOPE_DENIED',
        errorMessageSafe: 'Target di luar cakupan.',
      };
    // Gerbang 3: Docker tersedia dan daemon berjalan.
    try {
      await execFileAsync(this.dockerBin, ['info', '--format', '{{.ServerVersion}}'], {
        timeout: 10_000,
        env: { PATH: process.env['PATH'] ?? '' },
      });
    } catch {
      return {
        status: 'UNAVAILABLE',
        errorCode: 'TOOL_MISSING',
        errorMessageSafe: 'Docker tidak tersedia; Strix tidak dijalankan.',
        skippedReason: 'docker-unavailable',
        toolName: STRIX_TOOL,
        toolVersion: null,
      };
    }
    // Gerbang 4: kunci dan model harus di allowlist dan free-tier.
    const key = config.provider === 'gemini' ? this.keys.gemini : this.keys.groq;
    if (!key)
      return {
        status: 'UNAVAILABLE',
        errorCode: 'AUTH_ERROR',
        errorMessageSafe: 'Kunci provider untuk Strix tidak dikonfigurasi.',
        skippedReason: 'provider-key-missing',
      };
    const entry = findModel(this.registry, config.provider, config.model);
    if (!entry)
      return {
        status: 'UNAVAILABLE',
        errorCode: 'MODEL_UNAVAILABLE',
        errorMessageSafe: 'Model tidak ada di allowlist.',
        skippedReason: 'model-not-allowlisted',
      };
    if (!entry.freeTierAllowlisted)
      return {
        status: 'UNAVAILABLE',
        errorCode: 'CAPABILITY_MISMATCH',
        errorMessageSafe: 'Model belum diverifikasi free-tier.',
        skippedReason: 'free-tier-not-verified',
      };
    if (!entry.capabilities.text)
      return {
        status: 'UNAVAILABLE',
        errorCode: 'CAPABILITY_MISMATCH',
        errorMessageSafe: 'Model tidak mendukung teks.',
        skippedReason: 'capability-mismatch',
      };
    // Gerbang 5: runner belum terverifikasi.
    return {
      status: 'UNAVAILABLE',
      errorCode: 'TOOL_MISSING',
      errorMessageSafe:
        'Runner Strix belum diverifikasi terhadap versi CLI aktual; pemindaian tidak dijalankan.',
      skippedReason: `strix-runner-${STRIX_RUNNER_STATUS}`,
      toolName: STRIX_TOOL,
      toolVersion: null,
    };
  }
}

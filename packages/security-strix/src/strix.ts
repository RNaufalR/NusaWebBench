import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { z } from 'zod';
import {
  AppError,
  checkUrlInScope,
  createFinding,
  redactText,
  type Finding,
  type Severity,
} from '@nusawebbench/core';
import { MODEL_REGISTRY, findModel } from '@nusawebbench/ai';
import type { ModuleAdapter, ModuleContext, ModuleOutcome } from '@nusawebbench/orchestrator';
import {
  STRIX_PINNED_VERSION,
  STRIX_SANDBOX_IMAGE,
  runStrixProcess,
  type StrixFinding,
  type StrixProcessResult,
  type StrixScanMode,
} from './runner.js';

/**
 * Adapter Strix (SECURITY_STRIX, taskbook T-160).
 *
 * Alur: gerbang (opt-in, lokal, Docker, kunci, allowlist + free-tier model) → verifikasi versi
 * `strix -v` harus sama dengan versi terpin → eksekusi non-interaktif dengan timeout → baca status
 * run dan artefak → hasil.
 *
 * - Bila `strixBin` tidak dikonfigurasi, adapter TIDAK mencari Strix di PATH: hasil UNAVAILABLE.
 * - Temuan Strix adalah temuan AI: verification selalu LIKELY (tidak pernah CONFIRMED) dan
 *   status modul WARN, bukan PASS, bila ada temuan. PASS hanya berarti "run selesai tanpa temuan
 *   pada run ini", bukan jaminan keamanan.
 *
 * Sumber (diambil 2026-10-09): https://github.com/usestrix/strix (tag v1.7.0).
 */

export const STRIX_TOOL = 'strix';
const execFileAsync = promisify(execFile);

export const StrixConfigSchema = z.strictObject({
  enabled: z.boolean().default(false),
  provider: z.enum(['gemini', 'groq']).default('gemini'),
  model: z.string().min(1).max(100).default('gemini-3.8-flash'),
  maxRuntimeSec: z.number().int().min(60).max(600).default(300),
  scanMode: z.enum(['quick', 'standard', 'deep']).default('quick'),
  maxBudgetUsd: z.number().positive().max(5).default(0.5),
  maxTurns: z.number().int().min(1).max(100).default(30),
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
  /** Path biner Strix (dari konfigurasi eksplisit, mis. STRIX_BIN). Tanpa ini runner tidak jalan. */
  readonly strixBin?: string;
  /** Kunci provider (hanya dari environment, tidak pernah dicetak). */
  readonly providerKeys?: { readonly gemini?: string; readonly groq?: string };
  readonly registry?: typeof MODEL_REGISTRY;
};

const SEVERITY_MAP: Readonly<Record<string, Severity>> = {
  critical: 'CRITICAL',
  high: 'HIGH',
  medium: 'MEDIUM',
  low: 'LOW',
  info: 'INFO',
};

function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/** Versi dari `strix -v` (format `strix <versi>`). */
export function parseStrixVersion(output: string): string | null {
  const match = /^strix\s+(\d+\.\d+\.\d+)\s*$/m.exec(output.trim());
  return match?.[1] ?? null;
}

function toFinding(raw: StrixFinding, ctx: ModuleContext, createdAt: string): Finding {
  const body = [raw.description, raw.impact, `Referensi Strix: ${raw.id}`]
    .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
    .join('\n\n');
  return createFinding({
    runId: ctx.runId,
    moduleResultId: ctx.moduleResultId,
    category: 'SECURITY',
    title: truncate(redactText(raw.title), 200),
    description: truncate(redactText(body), 4000),
    severity: SEVERITY_MAP[raw.severity.toLowerCase()] ?? 'UNKNOWN',
    // Strix tidak melaporkan confidence. Nilai 0.5 adalah netral dan BUKAN skor dari Strix.
    confidence: 0.5,
    verification: 'LIKELY',
    source: 'AI',
    targetUrl: ctx.targetOrigin,
    selector: null,
    evidenceRefs: [],
    reproductionSteps: [],
    expected: null,
    actual: null,
    remediation: raw.remediation ? truncate(redactText(raw.remediation), 2000) : null,
    createdAt,
    status: 'OPEN',
    ruleId: null,
    ruleVersion: null,
  });
}

export class StrixAdapter implements ModuleAdapter {
  readonly module = 'SECURITY_STRIX' as const;
  readonly required = false;
  readonly timeoutMs = 600_000;
  readonly maxRetries = 0;
  private readonly rawConfig: unknown;
  private readonly dockerBin: string;
  private readonly strixBin: string | undefined;
  private readonly keys: { gemini?: string; groq?: string };
  private readonly registry: typeof MODEL_REGISTRY;

  constructor(options: StrixAdapterOptions = {}) {
    this.rawConfig = options.config ?? {};
    this.dockerBin = options.dockerBin ?? 'docker';
    this.strixBin = options.strixBin;
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
    // Gerbang 5: biner Strix harus dikonfigurasi eksplisit. Tidak ada pencarian di PATH.
    if (!this.strixBin)
      return {
        status: 'UNAVAILABLE',
        errorCode: 'TOOL_MISSING',
        errorMessageSafe:
          'Biner Strix belum dikonfigurasi (STRIX_BIN); pemindaian tidak dijalankan.',
        skippedReason: 'strix-bin-not-configured',
        toolName: STRIX_TOOL,
        toolVersion: null,
      };
    // Gerbang 6: versi runtime harus sama dengan versi terpin.
    const runtimeVersion = await this.readRuntimeVersion(this.strixBin);
    if (runtimeVersion !== STRIX_PINNED_VERSION) {
      return {
        status: 'ERROR',
        errorCode: 'TOOL_MISSING',
        errorMessageSafe: `Versi Strix tidak cocok dengan versi terpin ${STRIX_PINNED_VERSION}.`,
        toolName: STRIX_TOOL,
        toolVersion: runtimeVersion,
      };
    }

    const snapshot = {
      strixVersion: STRIX_PINNED_VERSION,
      sandboxImage: STRIX_SANDBOX_IMAGE,
      scanMode: config.scanMode,
      maxBudgetUsd: config.maxBudgetUsd,
      maxTurns: config.maxTurns,
      maxRuntimeSec: config.maxRuntimeSec,
      llmRoute: `${config.provider}/${config.model}`,
    };
    const raw = await runStrixProcess({
      bin: this.strixBin,
      target: ctx.targetOrigin,
      scanMode: config.scanMode as StrixScanMode,
      maxBudgetUsd: config.maxBudgetUsd,
      maxTurns: config.maxTurns,
      llmRoute: `${config.provider}/${config.model}`,
      apiKey: key,
      timeoutMs: config.maxRuntimeSec * 1000,
      signal: ctx.signal,
    });
    return this.toOutcome(raw, ctx, snapshot, runtimeVersion);
  }

  private async readRuntimeVersion(bin: string): Promise<string | null> {
    try {
      const { stdout } = await execFileAsync(bin, ['-v'], {
        timeout: 30_000,
        env: { PATH: process.env['PATH'] ?? '', HOME: process.env['HOME'] ?? '' },
      });
      return parseStrixVersion(stdout);
    } catch {
      return null;
    }
  }

  /** Pemetaan hasil proses + artefak ke hasil modul. Exit code saja tidak cukup untuk PASS. */
  toOutcome(
    raw: StrixProcessResult,
    ctx: ModuleContext,
    snapshot: Record<string, string | number | boolean | null>,
    runtimeVersion: string,
  ): ModuleOutcome {
    const base = {
      toolName: STRIX_TOOL,
      toolVersion: runtimeVersion,
      configSnapshot: { ...snapshot, exitCode: raw.exitCode, runStatus: raw.runStatus },
      metrics: { durationMs: raw.durationMs, findingCount: raw.findings.length },
    };
    if (raw.cancelled) {
      return {
        ...base,
        status: 'CANCELLED',
        errorCode: 'CANCELLED',
        errorMessageSafe: 'Strix dibatalkan.',
      };
    }
    if (raw.timedOut) {
      return {
        ...base,
        status: 'ERROR',
        errorCode: 'TIMEOUT',
        retryable: false,
        errorMessageSafe: 'Strix melewati batas waktu; proses dihentikan.',
      };
    }
    if (raw.signal !== null || (raw.exitCode !== 0 && raw.exitCode !== 2)) {
      return {
        ...base,
        status: 'ERROR',
        errorCode: 'TOOL_FAILED',
        errorMessageSafe: `Strix gagal (exit ${raw.exitCode ?? 'signal'}).`,
      };
    }
    if (raw.parseError !== null) {
      return {
        ...base,
        status: 'ERROR',
        errorCode: 'TOOL_FAILED',
        errorMessageSafe: `Artefak Strix tidak valid (${raw.parseError}).`,
      };
    }
    if (raw.runStatus !== 'completed') {
      return {
        ...base,
        status: 'ERROR',
        errorCode: 'TOOL_FAILED',
        errorMessageSafe: `Run Strix tidak selesai (status: ${truncate(redactText(raw.runStatus ?? 'unknown'), 40)}).`,
      };
    }
    const hasFindings = raw.findings.length > 0;
    if ((raw.exitCode === 2) !== hasFindings) {
      return {
        ...base,
        status: 'ERROR',
        errorCode: 'TOOL_FAILED',
        errorMessageSafe: 'Exit code Strix tidak konsisten dengan artefak temuan.',
      };
    }
    if (!hasFindings) return { ...base, status: 'PASS' };
    try {
      const createdAt = new Date().toISOString();
      const findings = raw.findings.map((f) => toFinding(f, ctx, createdAt));
      return { ...base, status: 'WARN', findings };
    } catch {
      return {
        ...base,
        status: 'ERROR',
        errorCode: 'TOOL_FAILED',
        errorMessageSafe: 'Temuan Strix tidak lolos validasi skema.',
      };
    }
  }
}

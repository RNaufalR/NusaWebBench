import { existsSync } from 'node:fs';
import {
  AppError,
  checkUrlInScope,
  createFinding,
  nowIso,
  redactText,
  type Finding,
  type Verification,
} from '@nusawebbench/core';
import type { ModuleAdapter, ModuleContext, ModuleOutcome } from '@nusawebbench/orchestrator';
import type { ArtifactStore } from '@nusawebbench/storage';
import type { Browser, LaunchOptions } from 'playwright-core';
import { z } from 'zod';
import { CollectError, collectSnapshot } from './collect.js';
import {
  RULE_CATALOG,
  SnapshotSchema,
  UX_RULE_IDS,
  UX_RULES_REGISTRY_VERSION,
  UX_RULES_TOOL,
  evaluateSnapshot,
  matchSuppression,
  ruleVersionOf,
  type RuleHit,
  type Snapshot,
  type UxRuleId,
} from './rules.js';

export const UxRulesConfigSchema = z.strictObject({
  startPath: z
    .string()
    .max(200)
    .regex(/^\/(?!\/)[^\\]*$/, { message: 'invalid-start-path' })
    .default('/'),
  /** Satu viewport per run (low-resource). Default: lebar mobil umum. */
  viewport: z
    .strictObject({
      width: z.number().int().min(320).max(2560),
      height: z.number().int().min(320).max(2560),
    })
    .default({ width: 390, height: 844 }),
  suppressions: z
    .array(
      z.strictObject({
        ruleId: z.enum(UX_RULE_IDS),
        selector: z.string().min(1).max(300).optional(),
        reason: z.string().min(3).max(200),
      }),
    )
    .max(50)
    .default([]),
});
export type UxRulesConfig = z.infer<typeof UxRulesConfigSchema>;

export function parseUxRulesConfig(raw: unknown): UxRulesConfig {
  const parsed = UxRulesConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new AppError('CONFIG_INVALID', { debugDetail: 'ux-rules-config' });
  return parsed.data;
}

export type UxRulesAdapterOptions = {
  readonly artifacts: ArtifactStore;
  readonly config?: unknown;
  readonly executablePath?: string | undefined;
  readonly timeoutMs?: number;
  readonly launch?: (o: LaunchOptions) => Promise<Browser>;
  /** Hook uji: snapshot pengganti tanpa browser (untuk tes negatif dan determinisme). */
  readonly snapshotProvider?: (ctx: ModuleContext, config: UxRulesConfig) => Promise<unknown>;
};

export class UxRulesAdapter implements ModuleAdapter {
  readonly module = 'UX_RULES' as const;
  readonly required = false;
  readonly timeoutMs: number;
  readonly maxRetries = 0;

  private readonly artifacts: ArtifactStore;
  private readonly rawConfig: unknown;
  private readonly executablePath: string | undefined;
  private readonly launch: UxRulesAdapterOptions['launch'];
  private readonly snapshotProvider: UxRulesAdapterOptions['snapshotProvider'];

  constructor(options: UxRulesAdapterOptions) {
    this.artifacts = options.artifacts;
    this.rawConfig = options.config ?? {};
    this.executablePath = options.executablePath ?? process.env['CHROMIUM_PATH'] ?? undefined;
    this.launch = options.launch;
    this.snapshotProvider = options.snapshotProvider;
    this.timeoutMs = options.timeoutMs ?? 90_000;
  }

  async run(ctx: ModuleContext): Promise<ModuleOutcome> {
    let config: UxRulesConfig;
    try {
      config = parseUxRulesConfig(this.rawConfig);
    } catch {
      return {
        status: 'ERROR',
        errorCode: 'CONFIG_INVALID',
        errorMessageSafe: 'Konfigurasi UX tidak valid.',
      };
    }

    const startUrl = new URL(config.startPath, ctx.grant.origin).href;
    const scope = await checkUrlInScope(startUrl, ctx.grant);
    if (!scope.allowed) {
      return {
        status: 'ERROR',
        errorCode: 'SCOPE_DENIED',
        errorMessageSafe: 'Target UX berada di luar cakupan.',
      };
    }

    let snapshot: Snapshot;
    if (this.snapshotProvider) {
      const parsed = SnapshotSchema.safeParse(await this.snapshotProvider(ctx, config));
      if (!parsed.success) {
        return {
          status: 'ERROR',
          errorCode: 'TOOL_FAILED',
          errorMessageSafe: 'Snapshot UX tidak valid.',
        };
      }
      snapshot = parsed.data;
    } else {
      if (this.executablePath === undefined || !existsSync(this.executablePath)) {
        return {
          status: 'UNAVAILABLE',
          errorCode: 'TOOL_MISSING',
          errorMessageSafe: 'Chromium untuk pemeriksaan UX tidak ditemukan.',
          skippedReason: 'browser-not-installed',
          toolName: UX_RULES_TOOL,
          toolVersion: UX_RULES_REGISTRY_VERSION,
        };
      }
      ctx.progress('ux-rules: mengumpulkan snapshot');
      try {
        snapshot = await collectSnapshot({
          grant: ctx.grant,
          url: startUrl,
          viewport: config.viewport,
          executablePath: this.executablePath,
          timeoutMs: Math.min(this.timeoutMs, 60_000),
          signal: ctx.signal,
          ...(this.launch ? { launch: this.launch } : {}),
        });
      } catch (err) {
        return this.outcomeForCollectError(err, ctx);
      }
    }
    if (ctx.signal.aborted) {
      return { status: 'ERROR', errorCode: 'CANCELLED', errorMessageSafe: 'Run dibatalkan.' };
    }

    ctx.progress('ux-rules: evaluasi aturan');
    const hits = evaluateSnapshot(snapshot);
    const evidenceId = this.saveSnapshot(ctx, snapshot);
    const createdAt = nowIso();
    const findings: Finding[] = [];
    const metrics: Record<string, number> = {
      elementsScanned:
        snapshot.headings.length +
        snapshot.images.length +
        snapshot.buttons.length +
        snapshot.inputs.length +
        snapshot.links.length,
      viewportWidth: snapshot.viewport.width,
      viewportHeight: snapshot.viewport.height,
      objectiveFindings: 0,
      subjectiveFindings: 0,
      suppressedFindings: 0,
      artifact_saved: evidenceId === null ? 0 : 1,
    };

    for (const hit of hits) {
      const rule = RULE_CATALOG[hit.ruleId];
      const suppression = matchSuppression(hit, config.suppressions);
      const verification: Verification =
        rule.kind === 'subjective' ? 'INFORMATIONAL' : evidenceId !== null ? 'CONFIRMED' : 'LIKELY';
      if (suppression) metrics['suppressedFindings'] = (metrics['suppressedFindings'] ?? 0) + 1;
      else if (rule.kind === 'objective')
        metrics['objectiveFindings'] = (metrics['objectiveFindings'] ?? 0) + 1;
      else metrics['subjectiveFindings'] = (metrics['subjectiveFindings'] ?? 0) + 1;

      findings.push(
        this.toFinding(
          ctx,
          hit,
          rule,
          verification,
          evidenceId,
          startUrl,
          config,
          createdAt,
          suppression,
        ),
      );
    }

    const openObjective = findings.filter((f) => f.status === 'OPEN' && isObjective(f.ruleId));
    const openSubjective = findings.filter((f) => f.status === 'OPEN' && !isObjective(f.ruleId));
    const status = openObjective.length > 0 ? 'FAIL' : openSubjective.length > 0 ? 'WARN' : 'PASS';
    return {
      status,
      metrics,
      findings,
      artifactRefs: evidenceId === null ? [] : [evidenceId],
      toolName: UX_RULES_TOOL,
      toolVersion: UX_RULES_REGISTRY_VERSION,
      errorCode: null,
      errorMessageSafe: null,
    };
  }

  private toFinding(
    ctx: ModuleContext,
    hit: RuleHit,
    rule: (typeof RULE_CATALOG)[UxRuleId],
    verification: Verification,
    evidenceId: string | null,
    pageUrl: string,
    config: UxRulesConfig,
    createdAt: string,
    suppression: { reason: string } | null,
  ): Finding {
    const prefix = suppression ? `[ditekan: ${suppression.reason}] ` : '';
    return createFinding({
      runId: ctx.runId,
      moduleResultId: ctx.moduleResultId,
      category: rule.category,
      title: rule.title,
      description: `${prefix}${redactText(hit.message)}`,
      severity: rule.severity,
      confidence: rule.kind === 'objective' ? 0.95 : 0.5,
      verification,
      source: 'DETERMINISTIC',
      targetUrl: pageUrl,
      selector: hit.selector,
      evidenceRefs: evidenceId !== null ? [evidenceId] : [],
      reproductionSteps: [
        `Buka ${pageUrl} pada viewport ${config.viewport.width}x${config.viewport.height}.`,
        hit.selector ? `Periksa elemen ${hit.selector}.` : 'Periksa halaman secara keseluruhan.',
      ],
      expected: rule.expected,
      actual: redactText(hit.actual).slice(0, 1000),
      remediation: rule.remediation,
      createdAt,
      status: suppression ? 'SUPPRESSED' : 'OPEN',
      ruleId: hit.ruleId,
      ruleVersion: ruleVersionOf(hit.ruleId),
    });
  }

  private saveSnapshot(ctx: ModuleContext, snapshot: Snapshot): string | null {
    try {
      const ev = this.artifacts.write({
        runId: ctx.runId,
        kind: 'json',
        mimeType: 'application/json',
        bytes: Buffer.from(JSON.stringify(redactDeep(snapshot)), 'utf8'),
        sourceTool: UX_RULES_TOOL,
        sourceVersion: UX_RULES_REGISTRY_VERSION,
        description: 'Snapshot DOM untuk pemeriksaan UX (sanitasi, tanpa skrip)',
        redactionApplied: true,
        synthetic: ctx.grant.mode === 'local-fixture',
      });
      return ev.id;
    } catch {
      return null;
    }
  }

  private outcomeForCollectError(err: unknown, ctx: ModuleContext): ModuleOutcome {
    if (ctx.signal.aborted || (err instanceof CollectError && err.reason === 'CANCELLED')) {
      return { status: 'ERROR', errorCode: 'CANCELLED', errorMessageSafe: 'Run dibatalkan.' };
    }
    if (err instanceof CollectError && err.reason === 'LAUNCH') {
      return {
        status: 'UNAVAILABLE',
        errorCode: 'TOOL_MISSING',
        errorMessageSafe: 'Browser Chromium gagal dijalankan untuk pemeriksaan UX.',
        skippedReason: 'browser-launch-failed',
        toolName: UX_RULES_TOOL,
        toolVersion: UX_RULES_REGISTRY_VERSION,
      };
    }
    if (err instanceof CollectError && err.timedOut) {
      return {
        status: 'ERROR',
        errorCode: 'TIMEOUT',
        errorMessageSafe: 'Pengumpulan snapshot UX melewati batas waktu.',
        retryable: true,
      };
    }
    if (err instanceof CollectError && err.reason === 'NAVIGATION') {
      return {
        status: 'ERROR',
        errorCode: 'TOOL_FAILED',
        errorMessageSafe: 'Halaman UX gagal dimuat atau berada di luar cakupan.',
      };
    }
    return {
      status: 'ERROR',
      errorCode: 'TOOL_FAILED',
      errorMessageSafe: 'Pemeriksaan UX gagal dijalankan.',
    };
  }
}

/** Redaksi rekursif per nilai string sebelum artefak disimpan (struktur JSON tetap utuh). */
function redactDeep(value: unknown): unknown {
  if (typeof value === 'string') return redactText(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = redactDeep(v);
    return out;
  }
  return value;
}

function isObjective(ruleId: string | null): boolean {
  if (ruleId === null || !(UX_RULE_IDS as readonly string[]).includes(ruleId)) return false;
  return RULE_CATALOG[ruleId as UxRuleId].kind === 'objective';
}

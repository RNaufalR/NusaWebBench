import { AppError } from './errors.js';
import type { SafeParser } from './schemas.js';
import { newId, nowIso } from './ids.js';
import {
  EvidenceSchema,
  FindingSchema,
  ModuleResultSchema,
  ProviderUsageSchema,
  RemediationProposalSchema,
  RunSchema,
  TargetSchema,
  type Target,
  type Evidence,
  type Finding,
  type ModuleResult,
  type ProviderUsage,
  type RemediationProposal,
  type Run,
} from './schemas.js';

/**
 * Mengubah hasil safeParse menjadi nilai tervalidasi atau AppError VALIDATION_FAILED.
 * Pesan error hanya memuat path dan kode issue, tidak pernah nilai input.
 */
export function parseOrThrow<T>(schema: SafeParser<T>, input: unknown, label: string): T {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  const issues = result.error.issues
    .slice(0, 10)
    .map((issue) => `${issue.path.map(String).join('.') || '(root)'}:${issue.message}`)
    .join('; ');
  throw new AppError('VALIDATION_FAILED', {
    safeMessage: `${label} tidak valid.`,
    debugDetail: issues,
  });
}

/** Factory: membuat Run baru dengan ID dan waktu yang dihasilkan sistem. */
export function createRun(input: {
  targetId: string;
  targetOrigin: string;
  targetMode: Run['targetMode'];
  authorization: Run['authorization'];
  configSnapshot: Run['configSnapshot'];
  now?: Date;
}): Run {
  const createdAt = nowIso(input.now);
  return parseOrThrow(
    RunSchema,
    {
      id: newId('run'),
      schemaVersion: 1,
      createdAt,
      startedAt: null,
      completedAt: null,
      targetId: input.targetId,
      targetOrigin: input.targetOrigin,
      targetMode: input.targetMode,
      authorization: input.authorization,
      configSnapshot: input.configSnapshot,
      status: 'QUEUED',
      moduleResults: [],
      findingIds: [],
      artifactRefs: [],
      errorSummary: null,
    },
    'Run',
  );
}

/** Factory: ModuleResult. Status non-hasil wajib memiliki alasan (dicek schema). */
export function createModuleResult(
  input: Omit<ModuleResult, 'id'> & { id?: string },
): ModuleResult {
  return parseOrThrow(
    ModuleResultSchema,
    { ...input, id: input.id ?? newId('module') },
    'ModuleResult',
  );
}

export function createFinding(
  input: Omit<Finding, 'id' | 'schemaVersion'> & { id?: string },
): Finding {
  return parseOrThrow(
    FindingSchema,
    { ...input, id: input.id ?? newId('finding'), schemaVersion: 1 },
    'Finding',
  );
}

export function createEvidence(input: Omit<Evidence, 'id'> & { id?: string }): Evidence {
  return parseOrThrow(EvidenceSchema, { ...input, id: input.id ?? newId('evidence') }, 'Evidence');
}

export function createProviderUsage(
  input: Omit<ProviderUsage, 'id'> & { id?: string },
): ProviderUsage {
  return parseOrThrow(
    ProviderUsageSchema,
    { ...input, id: input.id ?? newId('usage') },
    'ProviderUsage',
  );
}

export function createRemediationProposal(
  input: Omit<RemediationProposal, 'id'> & { id?: string },
): RemediationProposal {
  return parseOrThrow(
    RemediationProposalSchema,
    { ...input, id: input.id ?? newId('remediation') },
    'RemediationProposal',
  );
}

/** Factory: target baru. Nilai `scopeConfirmedAt` hanya diisi oleh guard setelah konfirmasi. */
export function createTarget(
  input: Omit<Target, 'id' | 'createdAt' | 'updatedAt'> & { now?: Date },
): Target {
  const { now, ...rest } = input;
  const at = nowIso(now);
  return parseOrThrow(
    TargetSchema,
    { ...rest, id: newId('target'), createdAt: at, updatedAt: at },
    'Target',
  );
}

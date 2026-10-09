import { z } from 'zod';
import {
  ALLOWED_ARTIFACT_MIME_TYPES,
  AI_TASK_TYPES,
  CATEGORIES,
  EVIDENCE_KINDS,
  FINDING_SOURCES,
  FINDING_STATUSES,
  MAX_ARTIFACT_BYTES,
  MODULE_ERROR_CODES,
  MODULE_NAMES,
  MODULE_STATUSES,
  NON_RESULT_MODULE_STATUSES,
  PROVIDER_USAGE_STATUSES,
  PROVIDERS,
  REMEDIATION_STATUSES,
  RUN_STATUSES,
  SCHEMA_VERSION,
  SEVERITIES,
  TARGET_MODES,
  TERMINAL_RUN_STATUSES,
  VERIFICATIONS,
} from './constants.js';
import { ID_PATTERN } from './ids.js';

/**
 * Schema runtime untuk seluruh kontrak data (taskbook §4.3–4.4). Semua objek memakai
 * `strictObject` sehingga field tambahan ditolak. Nilai yang berasal dari luar (API, adapter,
 * AI) harus melewati schema ini sebelum diteruskan ke subsistem lain.
 */

// ---------- primitive ----------

/** True jika string memuat karakter kontrol (kecuali tab, LF, CR). */
function hasControlChars(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if ((code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** Teks bebas dengan batas panjang dan tanpa karakter kontrol. */
export function safeText(max: number) {
  return z
    .string()
    .max(max)
    .refine((s) => !hasControlChars(s), { message: 'control-characters-not-allowed' });
}

/** Bentuk minimal schema yang dibutuhkan lapisan storage (tanpa mengekspor zod ke luar core). */
export type SafeParser<T> = {
  safeParse: (input: unknown) =>
    | { success: true; data: T }
    | {
        success: false;
        error: { issues: ReadonlyArray<{ path: ReadonlyArray<PropertyKey>; message: string }> };
      };
};

export const IdSchema = z.string().regex(ID_PATTERN, { message: 'invalid-id-format' });
/**
 * ISO 8601 UTC dengan tepat 3 digit milidetik dan akhiran Z (bentuk `Date#toISOString`).
 * Presisi dipaksa agar perbandingan string leksikografis sama dengan urutan waktu.
 */
export const IsoDateTimeSchema = z.iso.datetime({ offset: false, local: false, precision: 3 });
export const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/, { message: 'invalid-sha256' });
export const FiniteNumberSchema = z.number().finite();
export const DurationMsSchema = z
  .number()
  .int()
  .min(0)
  .max(7 * 24 * 60 * 60 * 1000);
export const CountSchema = z.number().int().min(0).max(1_000_000);

/**
 * Path relatif di dalam root artefak. Menolak absolut, drive Windows, backslash, NUL,
 * segmen kosong, `.` dan `..` (path traversal).
 */
export const RelativePathSchema = z
  .string()
  .min(1)
  .max(260)
  .refine((p) => !hasControlChars(p), { message: 'control-characters-not-allowed' })
  .refine((p) => !p.startsWith('/') && !/^[A-Za-z]:/.test(p) && !p.includes('\\'), {
    message: 'absolute-or-backslash-path',
  })
  .refine((p) => p.split('/').every((seg) => seg !== '' && seg !== '.' && seg !== '..'), {
    message: 'path-traversal-segment',
  });

/** Origin HTTP(S) tanpa userinfo, path, query, atau fragment. */
export const OriginSchema = z
  .string()
  .max(2048)
  .refine(
    (value) => {
      try {
        const u = new URL(value);
        return (
          (u.protocol === 'http:' || u.protocol === 'https:') &&
          u.username === '' &&
          u.password === '' &&
          u.pathname === '/' &&
          u.search === '' &&
          u.hash === '' &&
          // Bentuk kanonis persis seperti URL.origin (tanpa trailing slash, port default dihapus).
          u.origin === value
        );
      } catch {
        return false;
      }
    },
    { message: 'invalid-origin' },
  );

/** URL temuan: HTTP(S), tanpa userinfo. */
export const SafeUrlSchema = z
  .string()
  .max(2048)
  .refine(
    (value) => {
      try {
        const u = new URL(value);
        return (
          (u.protocol === 'http:' || u.protocol === 'https:') &&
          u.username === '' &&
          u.password === ''
        );
      } catch {
        return false;
      }
    },
    { message: 'invalid-url' },
  );

const ConfigValueSchema = z.union([
  z.string().max(500),
  z.number().finite(),
  z.boolean(),
  z.null(),
]);

/** Snapshot konfigurasi yang sudah disanitasi: nilai primitif, jumlah key terbatas. */
export const ConfigSnapshotSchema = z
  .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_.]{0,63}$/), ConfigValueSchema)
  .refine((obj) => Object.keys(obj).length <= 100, { message: 'too-many-config-keys' });

const MetricsSchema = z
  .record(z.string().regex(/^[a-zA-Z][A-Za-z0-9_.]{0,63}$/), z.number().finite())
  .refine((obj) => Object.keys(obj).length <= 200, { message: 'too-many-metrics' });

// ---------- Run ----------

export const AuthorizationSchema = z.strictObject({
  acknowledged: z.boolean(),
  scopeSummary: safeText(500),
  scopeHash: Sha256Schema.nullable(),
  approvedAt: IsoDateTimeSchema.nullable(),
});
export type Authorization = z.infer<typeof AuthorizationSchema>;

const IdListSchema = z.array(IdSchema).max(5000);

export const RunSchema = z
  .strictObject({
    id: IdSchema,
    schemaVersion: z.literal(SCHEMA_VERSION),
    createdAt: IsoDateTimeSchema,
    startedAt: IsoDateTimeSchema.nullable(),
    completedAt: IsoDateTimeSchema.nullable(),
    targetId: IdSchema,
    targetOrigin: OriginSchema,
    targetMode: z.enum(TARGET_MODES),
    authorization: AuthorizationSchema,
    configSnapshot: ConfigSnapshotSchema,
    status: z.enum(RUN_STATUSES),
    moduleResults: z.array(z.lazy(() => ModuleResultSchema)).max(50),
    findingIds: IdListSchema,
    artifactRefs: z.array(IdSchema).max(5000),
    errorSummary: safeText(500).nullable(),
  })
  .superRefine((run, ctx) => {
    if (run.startedAt !== null && run.startedAt < run.createdAt) {
      ctx.addIssue({ code: 'custom', path: ['startedAt'], message: 'started-before-created' });
    }
    if (run.completedAt !== null && run.startedAt !== null && run.completedAt < run.startedAt) {
      ctx.addIssue({ code: 'custom', path: ['completedAt'], message: 'completed-before-started' });
    }
    const terminal = (TERMINAL_RUN_STATUSES as readonly string[]).includes(run.status);
    if (terminal && run.completedAt === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'terminal-run-needs-completedAt',
      });
    }
    if (!terminal && run.completedAt !== null) {
      ctx.addIssue({
        code: 'custom',
        path: ['completedAt'],
        message: 'non-terminal-run-has-completedAt',
      });
    }
    if (run.status === 'QUEUED' && run.startedAt !== null) {
      ctx.addIssue({ code: 'custom', path: ['startedAt'], message: 'queued-run-has-startedAt' });
    }
    if (run.authorization.acknowledged && run.authorization.approvedAt === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['authorization', 'approvedAt'],
        message: 'approval-time-missing',
      });
    }
  });
export type Run = z.infer<typeof RunSchema>;

// ---------- ModuleResult ----------

export const ModuleResultSchema = z
  .strictObject({
    id: IdSchema,
    runId: IdSchema,
    module: z.enum(MODULE_NAMES),
    status: z.enum(MODULE_STATUSES),
    startedAt: IsoDateTimeSchema.nullable(),
    completedAt: IsoDateTimeSchema.nullable(),
    durationMs: DurationMsSchema.nullable(),
    toolName: safeText(100).nullable(),
    toolVersion: safeText(100).nullable(),
    configSnapshot: ConfigSnapshotSchema,
    metrics: MetricsSchema,
    findingIds: IdListSchema,
    artifactRefs: z.array(IdSchema).max(5000),
    errorCode: z.enum(MODULE_ERROR_CODES).nullable(),
    errorMessageSafe: safeText(500).nullable(),
    retryCount: z.number().int().min(0).max(10),
    skippedReason: safeText(300).nullable(),
  })
  .superRefine((m, ctx) => {
    const nonResult = (NON_RESULT_MODULE_STATUSES as readonly string[]).includes(m.status);
    if (Object.keys(m.metrics).length > 0 && nonResult) {
      // Angka tidak boleh muncul untuk modul yang tidak menghasilkan hasil (tidak ada angka palsu).
      ctx.addIssue({ code: 'custom', path: ['metrics'], message: 'metrics-on-non-result-status' });
    }
    if (m.status === 'SKIPPED' || m.status === 'NOT_RUN') {
      if (m.skippedReason === null) {
        ctx.addIssue({ code: 'custom', path: ['skippedReason'], message: 'skip-reason-required' });
      }
    }
    if (m.status === 'UNAVAILABLE' || m.status === 'ERROR' || m.status === 'CANCELLED') {
      if (m.errorCode === null && m.skippedReason === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['errorCode'],
          message: 'reason-required-for-status',
        });
      }
    }
    if (m.status === 'PASS' || m.status === 'FAIL' || m.status === 'WARN') {
      if (m.errorCode !== null) {
        ctx.addIssue({ code: 'custom', path: ['errorCode'], message: 'error-with-result-status' });
      }
    }
    if (m.startedAt !== null && m.completedAt !== null && m.completedAt < m.startedAt) {
      ctx.addIssue({ code: 'custom', path: ['completedAt'], message: 'completed-before-started' });
    }
  });
export type ModuleResult = z.infer<typeof ModuleResultSchema>;

// ---------- Finding ----------

export const FindingSchema = z
  .strictObject({
    id: IdSchema,
    schemaVersion: z.literal(SCHEMA_VERSION),
    runId: IdSchema,
    moduleResultId: IdSchema,
    category: z.enum(CATEGORIES),
    title: safeText(200).min(1),
    description: safeText(4000),
    severity: z.enum(SEVERITIES),
    confidence: z.number().finite().min(0).max(1),
    verification: z.enum(VERIFICATIONS),
    source: z.enum(FINDING_SOURCES),
    targetUrl: SafeUrlSchema.nullable(),
    selector: safeText(300).nullable(),
    evidenceRefs: z.array(IdSchema).max(50),
    reproductionSteps: z.array(safeText(500)).max(20),
    expected: safeText(1000).nullable(),
    actual: safeText(1000).nullable(),
    remediation: safeText(2000).nullable(),
    createdAt: IsoDateTimeSchema,
    status: z.enum(FINDING_STATUSES),
    ruleId: z
      .string()
      .regex(/^[a-z][a-z0-9-]{2,63}$/)
      .nullable(),
    ruleVersion: z
      .string()
      .regex(/^\d+\.\d+\.\d+$/)
      .nullable(),
  })
  .superRefine((f, ctx) => {
    const hasEvidence = f.evidenceRefs.length > 0;
    if (f.verification === 'CONFIRMED') {
      if (!hasEvidence) {
        ctx.addIssue({
          code: 'custom',
          path: ['evidenceRefs'],
          message: 'confirmed-requires-evidence',
        });
      }
      if (f.source === 'AI') {
        // Penilaian subjektif AI tidak boleh menjadi CONFIRMED (taskbook §8.3).
        ctx.addIssue({
          code: 'custom',
          path: ['verification'],
          message: 'ai-source-cannot-be-confirmed',
        });
      }
    }
    if (
      (f.verification === 'FIXED_VERIFIED' || f.verification === 'FIXED_UNVERIFIED') &&
      !hasEvidence
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['evidenceRefs'],
        message: 'fixed-status-requires-evidence',
      });
    }
    if (f.ruleId === null && f.source === 'DETERMINISTIC') {
      ctx.addIssue({
        code: 'custom',
        path: ['ruleId'],
        message: 'deterministic-finding-needs-rule',
      });
    }
    if (f.ruleId !== null && f.ruleVersion === null) {
      ctx.addIssue({ code: 'custom', path: ['ruleVersion'], message: 'rule-needs-version' });
    }
  });
export type Finding = z.infer<typeof FindingSchema>;

// ---------- Evidence ----------

export const EvidenceSchema = z.strictObject({
  id: IdSchema,
  runId: IdSchema,
  kind: z.enum(EVIDENCE_KINDS),
  pathRelative: RelativePathSchema,
  mimeType: z.enum(ALLOWED_ARTIFACT_MIME_TYPES),
  sizeBytes: z.number().int().min(0).max(MAX_ARTIFACT_BYTES),
  sha256: Sha256Schema,
  createdAt: IsoDateTimeSchema,
  sourceTool: safeText(100),
  sourceVersion: safeText(100),
  description: safeText(500),
  redactionApplied: z.boolean(),
  synthetic: z.boolean(),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

// ---------- ProviderUsage ----------

export const ProviderUsageSchema = z.strictObject({
  id: IdSchema,
  runId: IdSchema.nullable(),
  provider: z.enum(PROVIDERS),
  modelId: z.string().regex(/^[A-Za-z0-9._/:-]{1,100}$/),
  taskType: z.enum(AI_TASK_TYPES),
  requestCount: CountSchema,
  status: z.enum(PROVIDER_USAGE_STATUSES),
  durationMs: DurationMsSchema.nullable(),
  /** Hanya bila provider memberikan metadata token. */
  inputTokens: CountSchema.nullable(),
  outputTokens: CountSchema.nullable(),
  /** Selalu estimasi lokal, terpisah dari angka aktual provider. */
  estimatedTokens: CountSchema.nullable(),
  estimatedCost: z
    .strictObject({
      amountUsd: z.number().finite().min(0).max(1_000_000),
      priceTableDate: z.iso.date(),
      label: z.literal('estimated'),
    })
    .nullable(),
  localQuotaBucket: z.iso.date(),
  recordedAt: IsoDateTimeSchema,
  errorCode: z.enum(MODULE_ERROR_CODES).nullable(),
  fallbackFrom: z.enum(PROVIDERS).nullable(),
});
export type ProviderUsage = z.infer<typeof ProviderUsageSchema>;

// ---------- RemediationProposal ----------

const TestSummarySchema = z.strictObject({
  passed: CountSchema,
  failed: CountSchema,
  notRun: CountSchema,
  command: safeText(300),
});

export const RemediationProposalSchema = z
  .strictObject({
    id: IdSchema,
    findingIds: z.array(IdSchema).min(1).max(50),
    /** Lokal, tidak boleh dipublikasikan di laporan. Dihapus oleh serializer publik (T-170). */
    repositoryRoot: safeText(1024).nullable(),
    baseRevision: z
      .string()
      .regex(/^[a-f0-9]{7,64}$/)
      .nullable(),
    patchPath: RelativePathSchema.nullable(),
    status: z.enum(REMEDIATION_STATUSES),
    testsBefore: TestSummarySchema.nullable(),
    testsAfter: TestSummarySchema.nullable(),
    regressions: z.array(safeText(300)).max(200),
    approvedByUser: z.boolean(),
    createdAt: IsoDateTimeSchema,
  })
  .superRefine((r, ctx) => {
    if (r.status === 'VERIFIED') {
      if (r.testsBefore === null || r.testsAfter === null) {
        ctx.addIssue({
          code: 'custom',
          path: ['status'],
          message: 'verified-needs-before-and-after-tests',
        });
      } else if (r.testsAfter.failed > 0 || r.testsAfter.notRun > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['testsAfter'],
          message: 'verified-with-failing-or-missing-tests',
        });
      }
      if (r.regressions.length > 0) {
        ctx.addIssue({
          code: 'custom',
          path: ['regressions'],
          message: 'verified-with-regressions',
        });
      }
    }
  });
export type RemediationProposal = z.infer<typeof RemediationProposalSchema>;

// ---------- Target ----------

/** Target yang terdaftar. Validasi scope lanjutan dilakukan oleh guard (T-040). */
export const TargetSchema = z
  .strictObject({
    id: IdSchema,
    label: safeText(100).min(1),
    origin: OriginSchema,
    mode: z.enum(TARGET_MODES),
    allowedModules: z.array(z.enum(MODULE_NAMES)).max(MODULE_NAMES.length),
    scopeConfirmedAt: IsoDateTimeSchema.nullable(),
    createdAt: IsoDateTimeSchema,
    updatedAt: IsoDateTimeSchema,
  })
  .superRefine((t, ctx) => {
    if (new Set(t.allowedModules).size !== t.allowedModules.length) {
      ctx.addIssue({ code: 'custom', path: ['allowedModules'], message: 'duplicate-module' });
    }
    if (t.updatedAt < t.createdAt) {
      ctx.addIssue({ code: 'custom', path: ['updatedAt'], message: 'updated-before-created' });
    }
  });
export type Target = z.infer<typeof TargetSchema>;

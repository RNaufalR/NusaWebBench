/**
 * Konstanta domain tunggal. Semua enum status, severity, kategori, provider, dan kode error
 * didefinisikan di sini (taskbook T-020 instruksi 2). Modul lain harus mengimpor dari sini.
 */

/** Versi schema kontrak data (integer major). Naikkan hanya dengan migrasi yang terdokumentasi. */
export const SCHEMA_VERSION = 1 as const;

/** Batas ukuran artefak tunggal (50 MiB). */
export const MAX_ARTIFACT_BYTES = 50 * 1024 * 1024;

export const RUN_STATUSES = [
  'QUEUED',
  'RUNNING',
  'CANCELLING',
  'CANCELLED',
  'COMPLETED',
  'PARTIAL',
  'FAILED',
] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

/** Status yang tidak dapat berubah lagi (terminal). */
export const TERMINAL_RUN_STATUSES = ['CANCELLED', 'COMPLETED', 'PARTIAL', 'FAILED'] as const;

export const MODULE_STATUSES = [
  'QUEUED',
  'RUNNING',
  'PASS',
  'FAIL',
  'WARN',
  'SKIPPED',
  'UNAVAILABLE',
  'CANCELLED',
  'ERROR',
  'NOT_RUN',
] as const;
export type ModuleStatus = (typeof MODULE_STATUSES)[number];

/**
 * Status modul yang TIDAK boleh membawa hasil ukuran (metrics) dan wajib memiliki alasan.
 * UNAVAILABLE/SKIPPED/ERROR/NOT_RUN tidak pernah boleh dipromosikan menjadi PASS.
 */
export const NON_RESULT_MODULE_STATUSES = [
  'SKIPPED',
  'UNAVAILABLE',
  'ERROR',
  'NOT_RUN',
  'CANCELLED',
] as const;

export const MODULE_NAMES = [
  'FUNCTIONAL_QA',
  'LIGHTHOUSE',
  'UX_RULES',
  'AI_TEXT',
  'AI_VISUAL',
  'LOAD_K6',
  'SECURITY_STRIX',
  'REPORT',
] as const;
export type ModuleName = (typeof MODULE_NAMES)[number];

export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO', 'UNKNOWN'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const VERIFICATIONS = [
  'CONFIRMED',
  'LIKELY',
  'INFORMATIONAL',
  'FALSE_POSITIVE',
  'FIXED_VERIFIED',
  'FIXED_UNVERIFIED',
  'REGRESSION',
] as const;
export type Verification = (typeof VERIFICATIONS)[number];

/** Sumber temuan. Temuan dari AI tidak boleh berstatus CONFIRMED (taskbook §8.3). */
export const FINDING_SOURCES = ['DETERMINISTIC', 'SCANNER', 'AI'] as const;
export type FindingSource = (typeof FINDING_SOURCES)[number];

export const FINDING_STATUSES = ['OPEN', 'SUPPRESSED', 'RESOLVED'] as const;
export type FindingStatus = (typeof FINDING_STATUSES)[number];

export const CATEGORIES = [
  'FUNCTIONAL',
  'PERFORMANCE',
  'ACCESSIBILITY',
  'BEST_PRACTICES',
  'SEO',
  'UX_VISUAL',
  'LOAD',
  'SECURITY',
  'REMEDIATION',
] as const;
export type Category = (typeof CATEGORIES)[number];

export const PROVIDERS = ['gemini', 'groq'] as const;
export type Provider = (typeof PROVIDERS)[number];

export const TARGET_MODES = ['url', 'repository', 'fixture'] as const;
export type TargetMode = (typeof TARGET_MODES)[number];

export const AI_TASK_TYPES = [
  'TEXT_SUMMARY',
  'FINDING_EXPLANATION',
  'VISUAL_REVIEW',
  'STRUCTURED_REMEDIATION',
] as const;
export type AiTaskType = (typeof AI_TASK_TYPES)[number];

export const PROVIDER_USAGE_STATUSES = [
  'OK',
  'ERROR',
  'RATE_LIMITED',
  'UNAVAILABLE',
  'BLOCKED_BY_POLICY',
] as const;
export type ProviderUsageStatus = (typeof PROVIDER_USAGE_STATUSES)[number];

export const REMEDIATION_STATUSES = [
  'DRAFT',
  'READY_FOR_REVIEW',
  'TESTING',
  'VERIFIED',
  'REJECTED',
  'FAILED',
] as const;
export type RemediationStatus = (typeof REMEDIATION_STATUSES)[number];

export const EVIDENCE_KINDS = [
  'screenshot',
  'trace',
  'log',
  'html',
  'json',
  'lighthouse-report',
  'k6-summary',
  'strix-report',
  'patch',
  'markdown',
  'other',
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * MIME yang boleh disimpan sebagai artefak. Ekstensi file tidak dipercaya; MIME harus cocok
 * dengan deteksi konten (lihat packages/core artifact checks di T-060).
 */
export const ALLOWED_ARTIFACT_MIME_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'application/json',
  'application/zip',
  'text/plain',
  'text/html',
  'text/markdown',
] as const;

/**
 * Taksonomi error. `code` dipakai di data dan API; `safeMessage` boleh tampil ke pengguna;
 * detail internal (stack, cause, path) tidak pernah ikut dikembalikan.
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'PAYLOAD_TOO_LARGE',
  'NOT_FOUND',
  'CONFLICT',
  'FORBIDDEN',
  'SCOPE_DENIED',
  'CONSENT_REQUIRED',
  'LIMIT_EXCEEDED',
  'CONFIG_INVALID',
  'TOOL_MISSING',
  'TOOL_FAILED',
  'TIMEOUT',
  'CANCELLED',
  'STORAGE_ERROR',
  'ARTIFACT_ERROR',
  'INTERNAL',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

/** Kode error khusus provider AI (taskbook T-110/T-120). */
export const AI_ERROR_CODES = [
  'RATE_LIMITED',
  'AUTH_ERROR',
  'MODEL_UNAVAILABLE',
  'TIMEOUT',
  'INVALID_RESPONSE',
  'NETWORK_ERROR',
  'CAPABILITY_MISMATCH',
  'LOCAL_LIMIT_REACHED',
  'CONSENT_REQUIRED',
  'DISABLED',
  'UNKNOWN',
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

/** Gabungan kode error yang boleh muncul pada ModuleResult.errorCode. */
export const MODULE_ERROR_CODES = [...ERROR_CODES, ...AI_ERROR_CODES] as const;
export type ModuleErrorCode = (typeof MODULE_ERROR_CODES)[number];

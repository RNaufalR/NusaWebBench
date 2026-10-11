/** Data sintetis (label synthetic/demo) untuk tes kontrak. Tidak berisi data nyata. */
export const ids = {
  run: 'run_0123456789abcdef0123456789abcdef',
  module: 'mod_0123456789abcdef0123456789abcdef',
  finding: 'fnd_0123456789abcdef0123456789abcdef',
  evidence: 'evd_0123456789abcdef0123456789abcdef',
  target: 'tgt_0123456789abcdef0123456789abcdef',
};
export const sha = 'a'.repeat(64);
export const T0 = '2026-10-09T02:00:00.000Z';
export const T1 = '2026-10-09T02:00:05.000Z';

export function validRun(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.run,
    schemaVersion: 1,
    createdAt: T0,
    startedAt: T0,
    completedAt: T1,
    targetId: ids.target,
    targetOrigin: 'http://127.0.0.1:4178',
    targetMode: 'fixture',
    authorization: {
      acknowledged: true,
      scopeSummary: 'Fixture lokal (synthetic/demo)',
      scopeHash: sha,
      approvedAt: T0,
    },
    configSnapshot: { AI_PROVIDER: 'none', FREE_TIER_LOCK: true },
    status: 'COMPLETED',
    moduleResults: [],
    findingIds: [],
    artifactRefs: [],
    errorSummary: null,
    ...overrides,
  };
}

export function validModule(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.module,
    runId: ids.run,
    module: 'FUNCTIONAL_QA',
    status: 'PASS',
    startedAt: T0,
    completedAt: T1,
    durationMs: 5000,
    toolName: 'playwright',
    toolVersion: '1.64.0',
    configSnapshot: { viewport: '1280x720' },
    metrics: { pageCount: 1 },
    findingIds: [],
    artifactRefs: [],
    errorCode: null,
    errorMessageSafe: null,
    retryCount: 0,
    skippedReason: null,
    ...overrides,
  };
}

export function validFinding(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.finding,
    schemaVersion: 1,
    runId: ids.run,
    moduleResultId: ids.module,
    category: 'FUNCTIONAL',
    title: 'Halaman mengirim console error',
    description: 'Console error terdeteksi saat memuat halaman.',
    severity: 'MEDIUM',
    confidence: 0.9,
    verification: 'CONFIRMED',
    source: 'DETERMINISTIC',
    targetUrl: 'http://127.0.0.1:4178/',
    selector: null,
    evidenceRefs: [ids.evidence],
    reproductionSteps: ['Buka halaman utama'],
    expected: null,
    actual: null,
    remediation: null,
    createdAt: T0,
    status: 'OPEN',
    ruleId: 'console-error',
    ruleVersion: '1.0.0',
    ...overrides,
  };
}

export function validEvidence(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.evidence,
    runId: ids.run,
    kind: 'screenshot',
    pathRelative: `${ids.run}/screenshot-01.png`,
    mimeType: 'image/png',
    sizeBytes: 1024,
    sha256: sha,
    createdAt: T0,
    sourceTool: 'playwright',
    sourceVersion: '1.64.0',
    description: 'Screenshot halaman (synthetic/demo)',
    redactionApplied: false,
    synthetic: true,
    ...overrides,
  };
}

export function validUsage(overrides: Record<string, unknown> = {}) {
  return {
    id: 'use_0123456789abcdef0123456789abcdef',
    runId: null,
    provider: 'groq',
    modelId: 'example-model-1',
    taskType: 'TEXT_SUMMARY',
    requestCount: 1,
    status: 'OK',
    durationMs: 900,
    inputTokens: null,
    outputTokens: null,
    estimatedTokens: 120,
    estimatedCost: null,
    localQuotaBucket: '2026-10-09',
    recordedAt: T0,
    errorCode: null,
    fallbackFrom: null,
    ...overrides,
  };
}

const tests = { passed: 3, failed: 0, notRun: 0, command: 'npm test' };

export function validRemediation(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rem_0123456789abcdef0123456789abcdef',
    findingIds: [ids.finding],
    repositoryRoot: null,
    baseRevision: 'b3cc1a8',
    patchPath: 'patches/fix-1.diff',
    status: 'DRAFT',
    testsBefore: tests,
    testsAfter: null,
    regressions: [],
    approvedByUser: false,
    createdAt: T0,
    ...overrides,
  };
}

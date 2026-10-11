import { describe, expect, it } from 'vitest';
import {
  EvidenceSchema,
  FindingSchema,
  ModuleResultSchema,
  ProviderUsageSchema,
  RelativePathSchema,
  RemediationProposalSchema,
  RunSchema,
  OriginSchema,
  SafeUrlSchema,
  ERROR_CODES,
} from '../src/index.js';
import {
  validEvidence,
  validFinding,
  validModule,
  validRemediation,
  validRun,
  validUsage,
  ids,
  sha,
  T0,
} from './fixtures.js';

const ok = (schema: { safeParse: (v: unknown) => { success: boolean } }, v: unknown) =>
  schema.safeParse(v).success;

describe('schema valid cases', () => {
  it('menerima contoh Run, ModuleResult, Finding, Evidence, ProviderUsage, Remediation yang valid', () => {
    expect(ok(RunSchema, validRun())).toBe(true);
    expect(ok(ModuleResultSchema, validModule())).toBe(true);
    expect(ok(FindingSchema, validFinding())).toBe(true);
    expect(ok(EvidenceSchema, validEvidence())).toBe(true);
    expect(ok(ProviderUsageSchema, validUsage())).toBe(true);
    expect(ok(RemediationProposalSchema, validRemediation())).toBe(true);
  });

  it('menerima status non-hasil dengan alasan (SKIPPED/UNAVAILABLE)', () => {
    expect(
      ok(
        ModuleResultSchema,
        validModule({
          status: 'UNAVAILABLE',
          errorCode: 'TOOL_MISSING',
          metrics: {},
          toolVersion: null,
        }),
      ),
    ).toBe(true);
    expect(
      ok(
        ModuleResultSchema,
        validModule({
          status: 'SKIPPED',
          skippedReason: 'k6 dinonaktifkan',
          metrics: {},
          toolVersion: null,
        }),
      ),
    ).toBe(true);
  });
});

describe('schema invalid cases (negative)', () => {
  it('menolak properti yang hilang', () => {
    const v = validRun() as Record<string, unknown>;
    delete v['targetOrigin'];
    expect(ok(RunSchema, v)).toBe(false);
  });

  it('menolak field tambahan (strict)', () => {
    expect(ok(RunSchema, validRun({ extra: 'x' }))).toBe(false);
    expect(ok(FindingSchema, validFinding({ rawPrompt: 'x' }))).toBe(false);
  });

  it('menolak enum tidak valid', () => {
    expect(ok(RunSchema, validRun({ status: 'DONE' }))).toBe(false);
    expect(ok(ModuleResultSchema, validModule({ status: 'SUCCESS' }))).toBe(false);
    expect(ok(FindingSchema, validFinding({ severity: 'BLOCKER' }))).toBe(false);
  });

  it('menolak confidence di luar 0..1 dan NaN/Infinity', () => {
    expect(ok(FindingSchema, validFinding({ confidence: 1.5 }))).toBe(false);
    expect(ok(FindingSchema, validFinding({ confidence: -0.1 }))).toBe(false);
    expect(ok(FindingSchema, validFinding({ confidence: Number.NaN }))).toBe(false);
    expect(ok(FindingSchema, validFinding({ confidence: Number.POSITIVE_INFINITY }))).toBe(false);
  });

  it('menolak timestamp salah format (tanpa Z, tanggal saja, offset)', () => {
    expect(ok(RunSchema, validRun({ createdAt: '2026-10-09 02:00:00' }))).toBe(false);
    expect(ok(RunSchema, validRun({ createdAt: '2026-10-09' }))).toBe(false);
    expect(ok(RunSchema, validRun({ createdAt: '2026-10-09T09:00:00+07:00' }))).toBe(false);
    expect(ok(RunSchema, validRun({ createdAt: 'bukan-tanggal' }))).toBe(false);
    // Presisi harus tepat milidetik agar urutan string sama dengan urutan waktu.
    expect(ok(RunSchema, validRun({ createdAt: '2026-10-09T02:00:00Z' }))).toBe(false);
    expect(ok(RunSchema, validRun({ createdAt: '2026-10-09T02:00:00.5Z' }))).toBe(false);
    expect(ok(RunSchema, validRun({ createdAt: '2026-10-09T02:00:00.000000Z' }))).toBe(false);
  });

  it('menolak urutan waktu tidak logis', () => {
    expect(ok(RunSchema, validRun({ startedAt: '2026-10-09T01:00:00.000Z' }))).toBe(false);
    expect(ok(RunSchema, validRun({ completedAt: '2026-10-09T01:00:00.000Z' }))).toBe(false);
  });

  it('menolak run terminal tanpa completedAt dan run non-terminal dengan completedAt', () => {
    expect(ok(RunSchema, validRun({ completedAt: null }))).toBe(false);
    expect(ok(RunSchema, validRun({ status: 'RUNNING' }))).toBe(false);
  });

  it('menolak string terlalu panjang dan karakter kontrol', () => {
    expect(ok(FindingSchema, validFinding({ title: 'a'.repeat(201) }))).toBe(false);
    expect(ok(FindingSchema, validFinding({ description: 'a'.repeat(4001) }))).toBe(false);
    expect(ok(FindingSchema, validFinding({ title: 'judul\u0000rusak' }))).toBe(false);
    expect(ok(FindingSchema, validFinding({ title: '' }))).toBe(false);
  });

  it('menolak metrik pada status tanpa hasil (tidak ada angka palsu)', () => {
    expect(
      ok(
        ModuleResultSchema,
        validModule({ status: 'ERROR', errorCode: 'TIMEOUT', metrics: { performanceScore: 0 } }),
      ),
    ).toBe(false);
  });

  it('menolak PASS yang membawa errorCode, dan UNAVAILABLE tanpa alasan', () => {
    expect(ok(ModuleResultSchema, validModule({ status: 'PASS', errorCode: 'TIMEOUT' }))).toBe(
      false,
    );
    expect(
      ok(
        ModuleResultSchema,
        validModule({ status: 'UNAVAILABLE', errorCode: null, skippedReason: null }),
      ),
    ).toBe(false);
    expect(
      ok(ModuleResultSchema, validModule({ status: 'SKIPPED', skippedReason: null, metrics: {} })),
    ).toBe(false);
  });

  it('menolak kode error di luar taksonomi', () => {
    expect(ok(ModuleResultSchema, validModule({ status: 'ERROR', errorCode: 'MY_CUSTOM' }))).toBe(
      false,
    );
    expect(ERROR_CODES.length).toBeGreaterThan(5);
  });

  it('menolak CONFIRMED tanpa evidence dan CONFIRMED dari sumber AI', () => {
    expect(ok(FindingSchema, validFinding({ evidenceRefs: [] }))).toBe(false);
    expect(ok(FindingSchema, validFinding({ source: 'AI', ruleId: null, ruleVersion: null }))).toBe(
      false,
    );
  });

  it('menolak temuan deterministik tanpa ruleId dan rule tanpa versi', () => {
    expect(ok(FindingSchema, validFinding({ ruleId: null, ruleVersion: null }))).toBe(false);
    expect(ok(FindingSchema, validFinding({ ruleVersion: null }))).toBe(false);
    expect(ok(FindingSchema, validFinding({ ruleVersion: '1.0' }))).toBe(false);
  });

  it('menolak artifact reference yang tidak valid', () => {
    expect(ok(FindingSchema, validFinding({ evidenceRefs: ['../../etc/passwd'] }))).toBe(false);
    expect(ok(RunSchema, validRun({ artifactRefs: ['evd_short'] }))).toBe(false);
  });

  it('menolak status provider/payload dengan skema salah bentuk', () => {
    expect(ok(ProviderUsageSchema, validUsage({ provider: 'openai' }))).toBe(false);
    expect(ok(ProviderUsageSchema, validUsage({ requestCount: -1 }))).toBe(false);
    expect(ok(ProviderUsageSchema, validUsage({ inputTokens: 1.5 }))).toBe(false);
    expect(ok(ProviderUsageSchema, validUsage({ modelId: 'x'.repeat(101) }))).toBe(false);
    expect(
      ok(
        ProviderUsageSchema,
        validUsage({
          estimatedCost: { amountUsd: 0.1, priceTableDate: '2026-10-09', label: 'actual' },
        }),
      ),
    ).toBe(false);
  });

  it('menolak VERIFIED remediation tanpa tes sebelum/sesudah atau dengan tes gagal', () => {
    expect(
      ok(RemediationProposalSchema, validRemediation({ status: 'VERIFIED', testsAfter: null })),
    ).toBe(false);
    expect(
      ok(
        RemediationProposalSchema,
        validRemediation({
          status: 'VERIFIED',
          testsAfter: { passed: 2, failed: 1, notRun: 0, command: 'npm test' },
        }),
      ),
    ).toBe(false);
    expect(
      ok(
        RemediationProposalSchema,
        validRemediation({
          status: 'VERIFIED',
          testsAfter: { passed: 3, failed: 0, notRun: 0, command: 'npm test' },
          regressions: ['tes lama gagal'],
        }),
      ),
    ).toBe(false);
  });
});

describe('path, origin, dan URL boundary', () => {
  it.each([
    ['../secret.txt', 'traversal'],
    ['a/../../b', 'traversal'],
    ['/etc/passwd', 'absolute'],
    ['C:\\Windows\\win.ini', 'drive/backslash'],
    ['dir\\file.png', 'backslash'],
    ['a//b', 'empty-segment'],
    ['./a.png', 'dot-segment'],
    ['', 'empty'],
    ['a\u0000b', 'nul'],
  ])('menolak path %j (%s)', (value) => {
    expect(RelativePathSchema.safeParse(value).success).toBe(false);
  });

  it('menerima path relatif biasa', () => {
    expect(RelativePathSchema.safeParse('run_x/screenshot-01.png').success).toBe(true);
  });

  it.each([
    'https://example.com/path',
    'https://user:pass@example.com',
    'https://example.com?q=1',
    'HTTPS://Example.com',
    'ftp://example.com',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'https://example.com/', // bukan bentuk kanonis (trailing slash)
    'https://example.com:443', // port default tidak kanonis
  ])('menolak origin non-kanonis %j', (value) => {
    expect(OriginSchema.safeParse(value).success).toBe(false);
  });

  it('menerima origin kanonis dengan port', () => {
    expect(OriginSchema.safeParse('http://127.0.0.1:4178').success).toBe(true);
  });

  it('menolak URL temuan non-HTTP dan userinfo', () => {
    expect(SafeUrlSchema.safeParse('javascript:alert(1)').success).toBe(false);
    expect(SafeUrlSchema.safeParse('https://a:b@example.com/').success).toBe(false);
    expect(SafeUrlSchema.safeParse('https://example.com/x').success).toBe(true);
  });

  it('menolak NaN dan Infinity pada durasi dan ukuran', () => {
    expect(ok(ModuleResultSchema, validModule({ durationMs: Number.NaN }))).toBe(false);
    expect(ok(EvidenceSchema, validEvidence({ sizeBytes: Number.POSITIVE_INFINITY }))).toBe(false);
  });

  it('menolak ukuran artefak melebihi batas dan MIME di luar allowlist', () => {
    expect(ok(EvidenceSchema, validEvidence({ sizeBytes: 60 * 1024 * 1024 }))).toBe(false);
    expect(ok(EvidenceSchema, validEvidence({ mimeType: 'application/x-msdownload' }))).toBe(false);
    expect(ok(EvidenceSchema, validEvidence({ sha256: 'XYZ' }))).toBe(false);
  });

  it('menerima sha valid', () => {
    expect(sha.length).toBe(64);
    expect(ok(EvidenceSchema, validEvidence())).toBe(true);
  });

  it('id target & run memenuhi format', () => {
    expect(ids.run).toMatch(/^run_[a-f0-9]{32}$/);
    expect(T0.endsWith('Z')).toBe(true);
  });
});

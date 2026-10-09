import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  AppError,
  createEvidence,
  createFinding,
  createModuleResult,
  createRun,
  createTarget,
  type Finding,
  type ModuleErrorCode,
  type ModuleResult,
  type Run,
} from '@nusawebbench/core';
import { ArtifactStore, Store } from '@nusawebbench/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  assertNoKnownSecrets,
  buildReport,
  escapeHtml,
  renderReportHtml,
  renderReportMarkdown,
  ReportSchema,
  saveReport,
  type Report,
} from '../src/index.js';

// Semua nilai di bawah sintetis (synthetic/demo). Kanari secret dibentuk dari pola, bukan kunci nyata.
const CANARY_GOOGLE = `AIza${'Q'.repeat(35)}`;
const CANARY_GROQ = `gsk_${'Z'.repeat(40)}`;

let dir: string;
let store: Store;
let run: Run;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nwb-rep-'));
  store = Store.open(path.join(dir, 'db.sqlite'));
  const target = createTarget({
    label: 'fixture',
    origin: 'http://127.0.0.1:4178',
    mode: 'fixture',
    allowedModules: [],
    scopeConfirmedAt: null,
  });
  store.targets.insert(target);
  run = createRun({
    targetId: target.id,
    targetOrigin: target.origin,
    targetMode: 'fixture',
    authorization: {
      acknowledged: true,
      scopeSummary: 'Fixture lokal (synthetic/demo)',
      scopeHash: null,
      approvedAt: '2026-10-09T02:00:00.000Z',
    },
    configSnapshot: { AI_PROVIDER: 'none', FREE_TIER_LOCK: true },
  });
  store.runs.insert(run);
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function moduleResult(overrides: Partial<ModuleResult> = {}): ModuleResult {
  return createModuleResult({
    runId: run.id,
    module: 'UX_RULES',
    status: 'PASS',
    startedAt: '2026-10-09T02:00:00.000Z',
    completedAt: '2026-10-09T02:00:01.000Z',
    durationMs: 1000,
    toolName: 'ux-rules',
    toolVersion: '0.1.0',
    configSnapshot: {},
    metrics: { checks: 12 },
    findingIds: [],
    artifactRefs: [],
    errorCode: null,
    errorMessageSafe: null,
    retryCount: 0,
    skippedReason: null,
    ...overrides,
  });
}

function finding(overrides: Partial<Parameters<typeof createFinding>[0]> = {}): Finding {
  return createFinding({
    runId: run.id,
    moduleResultId: `mod_${'0'.repeat(32)}`,
    category: 'UX_VISUAL',
    title: 'Gambar tanpa alt text',
    description: 'Elemen img tidak memiliki atribut alt.',
    severity: 'MEDIUM',
    confidence: 0.9,
    verification: 'LIKELY',
    source: 'DETERMINISTIC',
    targetUrl: 'http://127.0.0.1:4178/index.html',
    selector: 'img.hero',
    evidenceRefs: [],
    reproductionSteps: ['Buka halaman', 'Periksa elemen img'],
    expected: 'alt tidak kosong',
    actual: 'atribut alt tidak ada',
    remediation: 'Tambahkan alt yang deskriptif.',
    createdAt: '2026-10-09T02:00:01.000Z',
    status: 'OPEN',
    ruleId: 'ux-img-alt',
    ruleVersion: '1.0.0',
    ...overrides,
  });
}

function buildFor(
  extra: { findings?: Finding[]; modules?: ModuleResult[]; synthetic?: boolean } = {},
): Report {
  return buildReport({
    run,
    moduleResults: extra.modules ?? [moduleResult()],
    findings: extra.findings ?? [],
    evidence: [],
    generatedAt: new Date('2026-10-09T02:05:00.000Z'),
    synthetic: extra.synthetic ?? true,
  });
}

describe('buildReport — schema versioned dan round-trip', () => {
  it('laporan tervalidasi dan round-trip JSON tetap valid', () => {
    const report = buildFor({ findings: [finding()] });
    expect(report.reportSchemaVersion).toBe(1);
    expect(report.generatorVersion).toBe('0.1.0');
    const again = ReportSchema.parse(JSON.parse(JSON.stringify(report)));
    expect(again).toEqual(report);
  });

  it('properti ekstra pada input tidak ikut masuk laporan (tanpa mass assignment)', () => {
    const polluted = {
      ...run,
      adminFlag: true,
      authorization: { ...run.authorization, extra: 'x' },
    } as Run;
    const report = buildReport({
      run: polluted,
      moduleResults: [moduleResult()],
      findings: [],
      evidence: [],
      generatedAt: new Date('2026-10-09T02:05:00.000Z'),
      synthetic: true,
    });
    expect(JSON.stringify(report)).not.toContain('adminFlag');
    expect(JSON.stringify(report)).not.toContain('"extra"');
  });

  it('modul ERROR tetap ada dengan statusnya sendiri, tidak diubah menjadi PASS', () => {
    const report = buildFor({
      modules: [
        moduleResult({
          module: 'FUNCTIONAL_QA',
          status: 'ERROR',
          metrics: {},
          errorCode: 'TIMEOUT',
          errorMessageSafe: 'Modul melewati batas waktu.',
          durationMs: 5000,
        }),
      ],
    });
    expect(report.modules[0]?.status).toBe('ERROR');
    expect(report.modules[0]?.isNonResult).toBe(true);
  });

  it('laporan tetap valid walau semua modul gagal dan tidak ada temuan', () => {
    const report = buildFor({
      modules: [
        moduleResult({
          status: 'UNAVAILABLE',
          metrics: {},
          errorCode: 'TOOL_MISSING',
          durationMs: null,
        }),
      ],
    });
    expect(report.findings).toEqual([]);
    expect(report.modules[0]?.isNonResult).toBe(true);
  });
});

describe('render HTML', () => {
  it('HTML injection pada judul, deskripsi, dan URL di-escape', () => {
    const malicious = finding({
      title: '<script>alert(1)</script>',
      description: '"><img src=x onerror=alert(1)>',
      targetUrl: 'https://example.com/?q="onmouseover="alert(1)',
    });
    const html = renderReportHtml(buildFor({ findings: [malicious] }));
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toMatch(/href="[^"]*"onmouseover/);
  });

  it('tidak ada script atau handler inline dalam HTML', () => {
    const html = renderReportHtml(buildFor({ findings: [finding()] }));
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/\son[a-z]+=/i);
    expect(html).toContain("script-src 'none'");
  });

  it('nilai hilang ditampilkan N/A dan tidak sebagai nol', () => {
    const report = buildFor({
      modules: [
        moduleResult({
          status: 'SKIPPED',
          metrics: {},
          skippedReason: 'modul opsional dimatikan',
          durationMs: null,
        }),
      ],
    });
    const html = renderReportHtml(report);
    expect(html).toContain('N/A');
    expect(html).toContain('SKIPPED (bukan hasil lulus)');
  });

  it('banner synthetic tampil hanya untuk data berlabel synthetic', () => {
    expect(renderReportHtml(buildFor({ synthetic: true }))).toContain('SYNTHETIC / DEMO');
    expect(renderReportHtml(buildFor({ synthetic: false }))).not.toContain('SYNTHETIC / DEMO');
  });

  it('judul laporan dan scope tampil di HTML (nilai asli)', () => {
    const html = renderReportHtml(buildFor());
    expect(html).toContain('<html lang="id">');
    expect(html).toContain('Fixture lokal (synthetic/demo)');
  });
});

describe('render Markdown', () => {
  it('karakter markup dinetralkan dan newline di judul dihapus', () => {
    const md = renderReportMarkdown(
      buildFor({ findings: [finding({ title: 'Judul | <b>*berbahaya*</b>\n# baru' })] }),
    );
    expect(md).not.toContain('<b>');
    expect(md).toContain('\\|');
    expect(md).not.toMatch(/\n# baru/);
  });
});

describe('secret canary', () => {
  it('pola secret di deskripsi temuan diredaksi dalam laporan JSON dan HTML', () => {
    const report = buildFor({
      findings: [finding({ description: `kunci bocor ${CANARY_GOOGLE} dan ${CANARY_GROQ}` })],
    });
    const json = JSON.stringify(report);
    const html = renderReportHtml(report);
    expect(json).not.toContain(CANARY_GOOGLE);
    expect(json).not.toContain(CANARY_GROQ);
    expect(html).not.toContain(CANARY_GOOGLE);
    expect(json).toContain('[REDACTED:GOOGLE_API_KEY]');
    expect(json).toContain('[REDACTED:GROQ_API_KEY]');
  });

  it('assertNoKnownSecrets menolak teks yang masih memuat pola secret', () => {
    expect(() => assertNoKnownSecrets(`x ${CANARY_GROQ}`)).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_ERROR' }),
    );
    expect(() => assertNoKnownSecrets('tidak ada secret di sini')).not.toThrow();
  });

  it('config snapshot tidak membawa nilai API key', () => {
    const report = buildFor();
    expect(JSON.stringify(report)).not.toMatch(/GEMINI_API_KEY"?:\s*"[^"]{8,}/);
  });
});

describe('validasi input laporan', () => {
  it('deskripsi melebihi batas ditolak', () => {
    expect(() => buildFor({ findings: [finding({ description: 'a'.repeat(4001) })] })).toThrow(
      expect.objectContaining({ code: 'VALIDATION_FAILED' }),
    );
  });

  it('kode error di luar taksonomi tidak bisa masuk (schema menolak)', () => {
    expect(() =>
      createModuleResult({
        runId: run.id,
        module: 'UX_RULES',
        status: 'ERROR',
        startedAt: null,
        completedAt: null,
        durationMs: null,
        toolName: null,
        toolVersion: null,
        configSnapshot: {},
        metrics: {},
        findingIds: [],
        artifactRefs: [],
        // Sengaja di luar tipe untuk menguji validasi runtime schema.
        errorCode: 'NOT_A_REAL_CODE' as unknown as ModuleErrorCode,
        errorMessageSafe: null,
        retryCount: 0,
        skippedReason: null,
      }),
    ).toThrow(AppError);
  });
});

describe('saveReport — penyimpanan artefak', () => {
  it('menyimpan JSON, HTML, dan Markdown sebagai evidence dengan hash yang bisa diverifikasi', () => {
    const artifacts = new ArtifactStore({
      rootDir: path.join(dir, 'artifacts'),
      evidence: store.evidence,
    });
    const report = buildFor({ findings: [finding()] });
    const saved = saveReport(artifacts, report);
    expect(saved.json.kind).toBe('json');
    expect(saved.html.mimeType).toBe('text/html');
    expect(saved.markdown.kind).toBe('markdown');
    const jsonBytes = artifacts.readVerified(saved.json.id);
    expect(ReportSchema.parse(JSON.parse(jsonBytes.toString('utf8')))).toEqual(report);
    expect(saved.json.synthetic).toBe(true);
    expect(saved.json.redactionApplied).toBe(true);
    expect(store.evidence.listByRun(run.id)).toHaveLength(3);
  });

  it('laporan tidak disimpan bila masih memuat secret (fail closed)', () => {
    const artifacts = new ArtifactStore({
      rootDir: path.join(dir, 'artifacts'),
      evidence: store.evidence,
    });
    const report = buildFor();
    const leaked = { ...report, limitations: [`bocor ${CANARY_GROQ}`] } as unknown as Report;
    expect(() => saveReport(artifacts, leaked)).toThrow(
      expect.objectContaining({ code: 'ARTIFACT_ERROR' }),
    );
    expect(store.evidence.listByRun(run.id)).toHaveLength(0);
  });

  it('evidence yang direferensikan laporan tetap tercantum', () => {
    const ev = createEvidence({
      runId: run.id,
      kind: 'json',
      pathRelative: `${run.id}/evd_${'1'.repeat(32)}.json`,
      mimeType: 'application/json',
      sizeBytes: 2,
      sha256: 'b'.repeat(64),
      createdAt: '2026-10-09T02:00:00.000Z',
      sourceTool: 'test',
      sourceVersion: '1',
      description: 'contoh',
      redactionApplied: true,
      synthetic: true,
    });
    const report = buildReport({
      run,
      moduleResults: [moduleResult()],
      findings: [],
      evidence: [ev],
      generatedAt: new Date('2026-10-09T02:05:00.000Z'),
      synthetic: true,
    });
    expect(report.evidence[0]?.sha256).toBe('b'.repeat(64));
    expect(renderReportHtml(report)).toContain('b'.repeat(64));
  });
});

describe('escapeHtml', () => {
  it('mengubah lima karakter berbahaya', () => {
    expect(escapeHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
});

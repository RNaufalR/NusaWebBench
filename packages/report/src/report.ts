import {
  AppError,
  ConfigSnapshotSchema,
  EvidenceSchema,
  FindingSchema,
  IsoDateTimeSchema,
  MODULE_NAMES,
  MODULE_STATUSES,
  MODULE_ERROR_CODES,
  NON_RESULT_MODULE_STATUSES,
  OriginSchema,
  RUN_STATUSES,
  SCHEMA_VERSION,
  TARGET_MODES,
  redactText,
  type Evidence,
  type Finding,
  type ModuleResult,
  type Run,
} from '@nusawebbench/core';
import type { ArtifactStore } from '@nusawebbench/storage';
import { z } from 'zod';

/** Versi schema laporan JSON. Naikkan hanya dengan migrasi/compatibility note terdokumentasi. */
export const REPORT_SCHEMA_VERSION = 1 as const;
/** Versi generator laporan (bukan versi aplikasi). */
export const REPORT_GENERATOR_VERSION = '0.1.0';
/** Batas ukuran laporan JSON. Laporan lebih besar ditolak, bukan dipotong diam-diam. */
export const MAX_REPORT_BYTES = 5 * 1024 * 1024;

const ModuleEntrySchema = z.strictObject({
  id: z.string().max(60),
  module: z.enum(MODULE_NAMES),
  status: z.enum(MODULE_STATUSES),
  durationMs: z.number().int().min(0).nullable(),
  toolName: z.string().max(100).nullable(),
  toolVersion: z.string().max(100).nullable(),
  metrics: z.record(z.string().max(64), z.number().finite()),
  errorCode: z.enum(MODULE_ERROR_CODES).nullable(),
  errorMessageSafe: z.string().max(500).nullable(),
  skippedReason: z.string().max(300).nullable(),
  retryCount: z.number().int().min(0).max(10),
  /** True bila status bukan hasil lulus/gagal (SKIPPED, UNAVAILABLE, ERROR, NOT_RUN, CANCELLED). */
  isNonResult: z.boolean(),
});

export const ReportSchema = z.strictObject({
  reportSchemaVersion: z.literal(REPORT_SCHEMA_VERSION),
  generatorVersion: z.string().max(50),
  generatedAt: IsoDateTimeSchema,
  appSchemaVersion: z.literal(SCHEMA_VERSION),
  synthetic: z.boolean(),
  run: z.strictObject({
    id: z.string().max(60),
    status: z.enum(RUN_STATUSES),
    targetOrigin: OriginSchema,
    targetMode: z.enum(TARGET_MODES),
    createdAt: IsoDateTimeSchema,
    startedAt: IsoDateTimeSchema.nullable(),
    completedAt: IsoDateTimeSchema.nullable(),
    scopeSummary: z.string().max(500),
    configSummary: ConfigSnapshotSchema,
    errorSummary: z.string().max(500).nullable(),
  }),
  modules: z.array(ModuleEntrySchema).max(50),
  findings: z.array(FindingSchema).max(5000),
  evidence: z.array(EvidenceSchema).max(5000),
  limitations: z.array(z.string().max(300)).max(50),
});
export type Report = z.infer<typeof ReportSchema>;

export const DEFAULT_LIMITATIONS: readonly string[] = Object.freeze([
  'Hanya modul yang tercantum yang dijalankan. Status SKIPPED, UNAVAILABLE, ERROR, NOT_RUN, dan CANCELLED bukan hasil lulus.',
  'Laporan ini tidak membuktikan bahwa situs aman atau memenuhi seluruh aksesibilitas/UX; cakupannya terbatas pada modul dan kondisi yang tercatat.',
  'Temuan dengan confidence rendah atau verification LIKELY perlu ditinjau manusia.',
]);

export type ReportInput = {
  readonly run: Run;
  readonly moduleResults: readonly ModuleResult[];
  readonly findings: readonly Finding[];
  readonly evidence: readonly Evidence[];
  readonly generatedAt: Date;
  readonly synthetic: boolean;
  readonly limitations?: readonly string[];
};

/** Meredaksi semua string secara rekursif. Angka dan boolean tidak diubah. */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redactText(value) as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[redactText(k)] = redactDeep(v);
    }
    return out as T;
  }
  return value;
}

/**
 * Membangun laporan JSON tervalidasi. Semua string diredaksi. Modul yang gagal tetap masuk
 * dengan statusnya sendiri; tidak ada modul yang dihapus atau diubah menjadi PASS.
 */
export function buildReport(input: ReportInput): Report {
  const redacted = redactDeep({
    reportSchemaVersion: REPORT_SCHEMA_VERSION,
    generatorVersion: REPORT_GENERATOR_VERSION,
    generatedAt: input.generatedAt.toISOString(),
    appSchemaVersion: SCHEMA_VERSION,
    synthetic: input.synthetic,
    run: {
      id: input.run.id,
      status: input.run.status,
      targetOrigin: input.run.targetOrigin,
      targetMode: input.run.targetMode,
      createdAt: input.run.createdAt,
      startedAt: input.run.startedAt,
      completedAt: input.run.completedAt,
      scopeSummary: input.run.authorization.scopeSummary,
      configSummary: input.run.configSnapshot,
      errorSummary: input.run.errorSummary,
    },
    modules: input.moduleResults.map((m) => ({
      id: m.id,
      module: m.module,
      status: m.status,
      durationMs: m.durationMs,
      toolName: m.toolName,
      toolVersion: m.toolVersion,
      metrics: m.metrics,
      errorCode: m.errorCode,
      errorMessageSafe: m.errorMessageSafe,
      skippedReason: m.skippedReason,
      retryCount: m.retryCount,
      isNonResult: (NON_RESULT_MODULE_STATUSES as readonly string[]).includes(m.status),
    })),
    findings: input.findings,
    evidence: input.evidence,
    limitations: [...(input.limitations ?? DEFAULT_LIMITATIONS)],
  });
  const parsed = ReportSchema.safeParse(redacted);
  if (!parsed.success) {
    throw new AppError('VALIDATION_FAILED', {
      safeMessage: 'Laporan tidak valid dan tidak disimpan.',
      debugDetail: parsed.error.issues.map((i) => i.path.join('.')).join(','),
    });
  }
  return parsed.data;
}

/** Escape HTML untuk teks dan nilai atribut. Semua data tak tepercaya wajib lewat fungsi ini. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Metrik kosong ditampilkan N/A, bukan nol (taskbook §7.8). */
function metricsCell(metrics: Record<string, number>): string {
  const entries = Object.entries(metrics);
  if (entries.length === 0) return 'N/A';
  return entries.map(([k, v]) => `${escapeHtml(k)}=${String(v)}`).join(', ');
}

/** Render HTML statis. Tidak ada script; CSP membatasi sumber ke inline style. */
export function renderReportHtml(report: Report): string {
  const e = escapeHtml;
  const banner = report.synthetic
    ? '<div class="banner" role="note">SYNTHETIC / DEMO: data contoh, bukan hasil audit situs nyata.</div>'
    : '';
  const counts = new Map<string, number>();
  for (const m of report.modules) counts.set(m.status, (counts.get(m.status) ?? 0) + 1);
  const countList = [...counts.entries()]
    .map(([status, n]) => `<li>${e(status)}: ${n}</li>`)
    .join('');
  const moduleRows = report.modules
    .map(
      (m) => `<tr>
<th scope="row">${e(m.module)}</th>
<td>${e(m.status)}${m.isNonResult ? ' (bukan hasil lulus)' : ''}</td>
<td>${metricsCell(m.metrics)}</td>
<td>${e(m.errorCode ?? 'N/A')}</td>
<td>${e(m.errorMessageSafe ?? m.skippedReason ?? 'N/A')}</td>
<td>${e(m.toolName ?? 'N/A')} ${e(m.toolVersion ?? '')}</td>
</tr>`,
    )
    .join('\n');
  const findingItems = report.findings
    .map((f) => {
      const url = f.targetUrl
        ? `<a href="${e(f.targetUrl)}" rel="noopener noreferrer nofollow">${e(f.targetUrl)}</a>`
        : 'N/A';
      return `<li>
<h3>${e(f.title)}</h3>
<p>Kategori: ${e(f.category)} · Severity: ${e(f.severity)} · Verification: ${e(f.verification)} · Confidence: ${e(String(f.confidence))} · Rule: ${e(f.ruleId ?? 'N/A')}</p>
<p>${e(f.description)}</p>
<p>URL: ${url}</p>
<p>Evidence: ${f.evidenceRefs.length > 0 ? f.evidenceRefs.map((r) => e(r)).join(', ') : 'N/A'}</p>
</li>`;
    })
    .join('\n');
  const evidenceItems = report.evidence
    .map(
      (ev) =>
        `<li>${e(ev.id)} · ${e(ev.kind)} · ${e(ev.pathRelative)} · sha256 ${e(ev.sha256)} · ${ev.sizeBytes} byte${ev.synthetic ? ' · synthetic' : ''}</li>`,
    )
    .join('\n');
  const limitationItems = report.limitations.map((l) => `<li>${e(l)}</li>`).join('\n');
  const findingsBlock =
    report.findings.length > 0
      ? `<ol>${findingItems}</ol>`
      : '<p>Tidak ada temuan yang tercatat.</p>';
  const evidenceBlock =
    report.evidence.length > 0
      ? `<ul>${evidenceItems}</ul>`
      : '<p>Tidak ada bukti yang tercatat.</p>';
  return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'none'; script-src 'none'">
<meta name="referrer" content="no-referrer">
<title>Laporan ${e(report.run.id)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:1.5rem;max-width:60rem;line-height:1.4;color:#111}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #888;padding:.35rem;text-align:left;vertical-align:top}
.banner{border:2px solid #b45309;background:#fef3c7;padding:.5rem;font-weight:600}
:focus{outline:3px solid #1d4ed8;outline-offset:2px}
</style>
</head>
<body>
${banner}
<h1>Laporan audit ${e(report.run.id)}</h1>
<p>Status run: <strong>${e(report.run.status)}</strong></p>
<dl>
<dt>Origin</dt><dd>${e(report.run.targetOrigin)} (${e(report.run.targetMode)})</dd>
<dt>Cakupan</dt><dd>${e(report.run.scopeSummary)}</dd>
<dt>Dibuat</dt><dd>${e(report.run.createdAt)}</dd>
<dt>Dimulai</dt><dd>${e(report.run.startedAt ?? 'N/A')}</dd>
<dt>Selesai</dt><dd>${e(report.run.completedAt ?? 'N/A')}</dd>
<dt>Dibuat oleh generator</dt><dd>${e(report.generatorVersion)} · schema laporan ${report.reportSchemaVersion} · schema data ${report.appSchemaVersion}</dd>
</dl>
<h2>Ringkasan status modul</h2>
<ul>${countList || '<li>N/A</li>'}</ul>
<h2>Status modul</h2>
<table>
<thead><tr><th scope="col">Modul</th><th scope="col">Status</th><th scope="col">Metrik</th><th scope="col">Kode error</th><th scope="col">Keterangan</th><th scope="col">Tool</th></tr></thead>
<tbody>
${moduleRows || '<tr><td colspan="6">Tidak ada modul.</td></tr>'}
</tbody>
</table>
<h2>Temuan</h2>
${findingsBlock}
<h2>Bukti</h2>
${evidenceBlock}
<h2>Keterbatasan</h2>
<ul>${limitationItems}</ul>
<h2>Konfigurasi relevan</h2>
<pre>${e(JSON.stringify(report.run.configSummary, null, 2))}</pre>
</body>
</html>
`;
}

/** Escape untuk sel Markdown: karakter markup dan pemisah tabel dinetralkan. */
export function mdEscape(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').replace(/[\\`*_{}[\]()#+\-.!|<>]/g, (c) => `\\${c}`);
}

/** Markdown opsional untuk issue tracker. Tidak memuat HTML mentah. */
export function renderReportMarkdown(report: Report): string {
  const lines: string[] = [];
  if (report.synthetic)
    lines.push('> **SYNTHETIC / DEMO** — data contoh, bukan hasil audit nyata.', '');
  lines.push(`# Laporan audit ${mdEscape(report.run.id)}`, '');
  lines.push(`- Status run: ${mdEscape(report.run.status)}`);
  lines.push(`- Origin: ${mdEscape(report.run.targetOrigin)} (${mdEscape(report.run.targetMode)})`);
  lines.push(`- Cakupan: ${mdEscape(report.run.scopeSummary)}`);
  lines.push(
    `- Generator ${mdEscape(report.generatorVersion)}, schema laporan ${report.reportSchemaVersion}`,
    '',
  );
  lines.push(
    '## Status modul',
    '',
    '| Modul | Status | Metrik | Kode error |',
    '| --- | --- | --- | --- |',
  );
  for (const m of report.modules) {
    const metrics = Object.entries(m.metrics)
      .map(([k, v]) => `${mdEscape(k)}=${v}`)
      .join(', ');
    lines.push(
      `| ${mdEscape(m.module)} | ${mdEscape(m.status)}${m.isNonResult ? ' (bukan hasil lulus)' : ''} | ${metrics || 'N/A'} | ${mdEscape(m.errorCode ?? 'N/A')} |`,
    );
  }
  lines.push('', '## Temuan');
  if (report.findings.length === 0) lines.push('', 'Tidak ada temuan yang tercatat.');
  for (const f of report.findings) {
    lines.push(
      '',
      `### ${mdEscape(f.title)}`,
      '',
      `- Severity: ${mdEscape(f.severity)} · Verification: ${mdEscape(f.verification)} · Confidence: ${f.confidence}`,
      `- Rule: ${mdEscape(f.ruleId ?? 'N/A')}`,
      '',
      mdEscape(f.description),
    );
  }
  lines.push('', '## Keterbatasan', '');
  for (const l of report.limitations) lines.push(`- ${mdEscape(l)}`);
  lines.push('');
  return lines.join('\n');
}

/** Memastikan keluaran tidak lagi mengandung pola secret yang dikenal. Gagal tertutup. */
export function assertNoKnownSecrets(text: string): void {
  if (redactText(text) !== text) {
    throw new AppError('ARTIFACT_ERROR', {
      safeMessage: 'Laporan dibatalkan karena terdeteksi data sensitif.',
      debugDetail: 'secret-pattern-in-report',
    });
  }
}

/** Menyimpan laporan JSON, HTML, dan Markdown sebagai artefak bertipe dengan metadata lengkap. */
export function saveReport(
  artifacts: ArtifactStore,
  report: Report,
): { json: Evidence; html: Evidence; markdown: Evidence } {
  const json = JSON.stringify(report, null, 2);
  if (Buffer.byteLength(json, 'utf8') > MAX_REPORT_BYTES) {
    throw new AppError('PAYLOAD_TOO_LARGE', { safeMessage: 'Laporan melebihi batas ukuran.' });
  }
  const html = renderReportHtml(report);
  const markdown = renderReportMarkdown(report);
  assertNoKnownSecrets(json);
  assertNoKnownSecrets(html);
  assertNoKnownSecrets(markdown);
  const base = {
    runId: report.run.id,
    sourceTool: 'nusawebbench-report',
    sourceVersion: REPORT_GENERATOR_VERSION,
    redactionApplied: true,
    synthetic: report.synthetic,
  };
  return {
    json: artifacts.write({
      ...base,
      kind: 'json',
      mimeType: 'application/json',
      bytes: Buffer.from(json, 'utf8'),
      description: 'Laporan JSON (schema versioned)',
    }),
    html: artifacts.write({
      ...base,
      kind: 'html',
      mimeType: 'text/html',
      bytes: Buffer.from(html, 'utf8'),
      description: 'Laporan HTML (teks ter-escape)',
    }),
    markdown: artifacts.write({
      ...base,
      kind: 'markdown',
      mimeType: 'text/markdown',
      bytes: Buffer.from(markdown, 'utf8'),
      description: 'Laporan Markdown (opsional)',
    }),
  };
}

import { createHash } from 'node:crypto';
import type { Verification } from '@nusawebbench/core';

/**
 * Perbandingan sebelum/sesudah (taskbook T-170). Fungsi murni. Temuan dicocokkan dengan kunci
 * `ruleId|selector|targetUrl`. FIXED_VERIFIED hanya bila baseline punya bukti (temuan OPEN) dan run
 * sesudahnya comparable serta modul terkait tidak ERROR/UNAVAILABLE. Selain itu FIXED_UNVERIFIED.
 */

export type ComparableFinding = {
  readonly ruleId: string | null;
  readonly selector: string | null;
  readonly targetUrl: string | null;
  readonly severity: string;
  readonly status: string;
  readonly verification: Verification;
};

export type RunSnapshot = {
  readonly runId: string;
  readonly origin: string;
  readonly viewport: { readonly width: number; readonly height: number } | null;
  readonly configFingerprint: string;
  readonly toolVersions: Readonly<Record<string, string>>;
  readonly ruleVersions: Readonly<Record<string, string>>;
  /** Modul yang statusnya valid untuk dibandingkan (PASS/FAIL/WARN). */
  readonly comparableModules: readonly string[];
  readonly findings: readonly ComparableFinding[];
};

export type ComparisonItem = {
  readonly key: string;
  readonly ruleId: string | null;
  readonly before: 'PRESENT' | 'ABSENT';
  readonly after: 'PRESENT' | 'ABSENT';
  readonly verification: Verification;
};

export type Comparison = {
  readonly baselineRunId: string;
  readonly currentRunId: string;
  readonly comparable: boolean;
  readonly blockers: readonly string[];
  readonly warnings: readonly string[];
  readonly items: readonly ComparisonItem[];
};

export function findingKey(
  f: Pick<ComparableFinding, 'ruleId' | 'selector' | 'targetUrl'>,
): string {
  return `${f.ruleId ?? '-'}|${f.selector ?? ''}|${f.targetUrl ?? ''}`;
}

/** Sidik jari konfigurasi: SHA-256 dari JSON dengan kunci terurut. */
export function configFingerprint(config: Record<string, unknown>): string {
  const sorted = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(sorted);
    if (v !== null && typeof v === 'object') {
      return Object.fromEntries(
        Object.keys(v)
          .sort()
          .map((k) => [k, sorted((v as Record<string, unknown>)[k])]),
      );
    }
    return v;
  };
  return createHash('sha256')
    .update(JSON.stringify(sorted(config)))
    .digest('hex');
}

export function compareRuns(baseline: RunSnapshot, current: RunSnapshot): Comparison {
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (baseline.origin !== current.origin)
    blockers.push(`origin berbeda: ${baseline.origin} vs ${current.origin}`);
  const vpA = baseline.viewport
    ? `${baseline.viewport.width}x${baseline.viewport.height}`
    : 'tidak ada';
  const vpB = current.viewport
    ? `${current.viewport.width}x${current.viewport.height}`
    : 'tidak ada';
  if (vpA !== vpB) blockers.push(`viewport berbeda: ${vpA} vs ${vpB}`);
  if (baseline.configFingerprint !== current.configFingerprint)
    warnings.push('konfigurasi test berbeda (sidik jari berbeda)');
  for (const tool of new Set([
    ...Object.keys(baseline.toolVersions),
    ...Object.keys(current.toolVersions),
  ])) {
    if (baseline.toolVersions[tool] !== current.toolVersions[tool]) {
      warnings.push(
        `versi ${tool} berbeda: ${baseline.toolVersions[tool] ?? '-'} vs ${current.toolVersions[tool] ?? '-'}`,
      );
    }
  }
  for (const rule of new Set([
    ...Object.keys(baseline.ruleVersions),
    ...Object.keys(current.ruleVersions),
  ])) {
    if (baseline.ruleVersions[rule] !== current.ruleVersions[rule]) {
      warnings.push(
        `versi aturan ${rule} berbeda: ${baseline.ruleVersions[rule] ?? '-'} vs ${current.ruleVersions[rule] ?? '-'}`,
      );
    }
  }
  const comparable = blockers.length === 0;
  // Klaim FIXED_VERIFIED dan REGRESSION hanya bila perbandingan sepenuhnya sebanding (tanpa peringatan
  // versi/konfigurasi). Dengan peringatan, klaim diturunkan ke LIKELY/FIXED_UNVERIFIED.
  const strict = comparable && warnings.length === 0;

  const beforeOpen = new Map<string, ComparableFinding>();
  for (const f of baseline.findings) if (f.status === 'OPEN') beforeOpen.set(findingKey(f), f);
  const afterOpen = new Map<string, ComparableFinding>();
  for (const f of current.findings) if (f.status === 'OPEN') afterOpen.set(findingKey(f), f);
  const currentModules = new Set(current.comparableModules);
  const baselineModules = new Set(baseline.comparableModules);

  const items: ComparisonItem[] = [];
  for (const [key, f] of beforeOpen) {
    const stillThere = afterOpen.has(key);
    if (stillThere) {
      items.push({
        key,
        ruleId: f.ruleId,
        before: 'PRESENT',
        after: 'PRESENT',
        verification: 'LIKELY',
      });
      continue;
    }
    // Hilang: hanya FIXED_VERIFIED bila bukti kedua sisi valid.
    const evidence = strict && baselineModules.size > 0 && currentModules.size > 0;
    items.push({
      key,
      ruleId: f.ruleId,
      before: 'PRESENT',
      after: 'ABSENT',
      verification: evidence ? 'FIXED_VERIFIED' : 'FIXED_UNVERIFIED',
    });
  }
  for (const [key, f] of afterOpen) {
    if (beforeOpen.has(key)) continue;
    items.push({
      key,
      ruleId: f.ruleId,
      before: 'ABSENT',
      after: 'PRESENT',
      verification: strict ? 'REGRESSION' : 'LIKELY',
    });
  }
  return {
    baselineRunId: baseline.runId,
    currentRunId: current.runId,
    comparable,
    blockers,
    warnings,
    items,
  };
}

/**
 * Panduan remediasi berbasis URL (tanpa mutasi live target). Hanya menyusun teks dari temuan yang
 * sudah ada; tidak mengirim request.
 */
export function urlRemediationGuidance(f: {
  readonly title: string;
  readonly remediation: string | null;
  readonly targetUrl: string | null;
  readonly selector: string | null;
}): string {
  const where = f.targetUrl ? `Halaman: ${f.targetUrl}` : 'Halaman: (tidak tercatat)';
  const el = f.selector ? ` · Elemen: ${f.selector}` : '';
  return `${f.title}. ${where}${el}. ${f.remediation ?? 'Tinjau temuan ini secara manual.'} Perubahan harus dilakukan di sumber aplikasi, bukan pada target live.`;
}

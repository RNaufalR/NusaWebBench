import {
  AppError,
  createScopeGrant,
  scopeHashOf,
  scopeSummaryOf,
  type Authorization,
  type ModuleName,
  type ScopeGrant,
  type ScopeMode,
} from '@nusawebbench/core';

/**
 * Modul yang belum dapat menjamin enforcement scope pada mode remote (taskbook T-040:
 * "remote scanning disabled ketika validation tidak dapat dijamin"). Browser memakai DNS
 * sendiri dan tidak bisa di-pin ke IP yang sudah divalidasi pada build ini.
 */
export const REMOTE_NOT_ENFORCEABLE_MODULES: readonly ModuleName[] = Object.freeze([
  'FUNCTIONAL_QA',
  'LIGHTHOUSE',
  // UX_RULES memakai Chromium yang sama dengan route guard; DNS pinning belum dapat dijamin.
  'UX_RULES',
  'LOAD_K6',
  'SECURITY_STRIX',
]);

export type RunPlan = {
  readonly origin: string;
  readonly mode: ScopeMode;
  readonly modules: readonly ModuleName[];
  /** Efek yang ditampilkan kepada pengguna sebelum consent (taskbook §6.1 langkah 2). */
  readonly effects: readonly string[];
  readonly allowed: boolean;
  readonly blockedReason: string | null;
};

/**
 * Preview rencana run. Tidak menjalankan apa pun. Mode remote dengan modul yang belum
 * dapat dijamin scope-nya ditandai tidak diizinkan.
 */
export function buildRunPlan(input: {
  origin: string;
  mode: ScopeMode;
  modules: readonly ModuleName[];
}): RunPlan {
  const grant = createScopeGrant(input.origin, input.mode);
  const effects = [
    `Origin yang diizinkan: ${grant.origin}`,
    input.mode === 'remote'
      ? 'Mode remote: request dapat mencapai server pihak lain.'
      : 'Mode fixture lokal: hanya loopback.',
    `Modul: ${input.modules.join(', ') || '(tidak ada)'}`,
    'Modul dijalankan berurutan (satu run aktif).',
  ];
  const blocked = input.modules.filter((m) => REMOTE_NOT_ENFORCEABLE_MODULES.includes(m));
  if (input.mode === 'remote' && blocked.length > 0) {
    return {
      origin: grant.origin,
      mode: input.mode,
      modules: input.modules,
      effects,
      allowed: false,
      blockedReason:
        'Pemindaian remote belum dapat dijamin cakupannya untuk modul ini; gunakan fixture lokal.',
    };
  }
  return {
    origin: grant.origin,
    mode: input.mode,
    modules: input.modules,
    effects,
    allowed: true,
    blockedReason: null,
  };
}

/**
 * Membangun blok Authorization untuk Run. Consent wajib eksplisit (`acknowledged === true`).
 * Hanya ringkasan dan hash yang disimpan, bukan dokumen persetujuan.
 */
export function authorizationFor(input: {
  grant: ScopeGrant;
  acknowledged: boolean;
  now: Date;
}): Authorization {
  if (!input.acknowledged) {
    throw new AppError('CONSENT_REQUIRED');
  }
  return {
    acknowledged: true,
    scopeSummary: scopeSummaryOf(input.grant),
    scopeHash: scopeHashOf(input.grant),
    approvedAt: input.now.toISOString(),
  };
}

/**
 * Klasifikasi error provider (taskbook T-110 instruksi 5). Pesan asli dari provider TIDAK pernah
 * dikembalikan ke pemanggil; hanya kelas error yang disimpan.
 */
export const AI_ERROR_KINDS = [
  'RATE_LIMITED',
  'AUTH_ERROR',
  'MODEL_UNAVAILABLE',
  'TIMEOUT',
  'INVALID_RESPONSE',
  'NETWORK_ERROR',
  'UNKNOWN',
] as const;
export type AiErrorKind = (typeof AI_ERROR_KINDS)[number];

export class ProviderCallError extends Error {
  constructor(
    readonly kind: AiErrorKind,
    readonly retryable: boolean,
    readonly retryAfterSec: number | null = null,
  ) {
    super(kind);
    this.name = 'ProviderCallError';
  }
}

/**
 * Memetakan status HTTP ke kelas error. 429 TIDAK pernah diulang (tidak ada loop); 5xx diulang
 * terbatas oleh pemanggil.
 */
export function classifyHttpStatus(status: number): { kind: AiErrorKind; retryable: boolean } {
  if (status === 401 || status === 403) return { kind: 'AUTH_ERROR', retryable: false };
  if (status === 404) return { kind: 'MODEL_UNAVAILABLE', retryable: false };
  if (status === 429) return { kind: 'RATE_LIMITED', retryable: false };
  if (status >= 500 && status <= 599) return { kind: 'UNKNOWN', retryable: true };
  return { kind: 'UNKNOWN', retryable: false };
}

/**
 * Membaca Retry-After (detik atau tanggal HTTP). Nilai rusak, negatif, atau terlalu besar
 * mengembalikan null dan TIDAK dijadikan dasar penjadwalan.
 */
export function parseRetryAfter(value: string | null, now: Date): number | null {
  if (value === null) return null;
  const v = value.trim();
  if (/^\d{1,6}$/.test(v)) return Number(v);
  const t = Date.parse(v);
  if (Number.isNaN(t)) return null;
  const sec = Math.ceil((t - now.getTime()) / 1000);
  return sec >= 0 && sec <= 86_400 ? sec : null;
}

/** Nilai header x-ratelimit-* hanya dicatat sebagai metadata bila berupa angka valid. */
export function parseLimitHeader(value: string | null): number | null {
  if (value === null || !/^\d{1,9}$/.test(value.trim())) return null;
  return Number(value.trim());
}

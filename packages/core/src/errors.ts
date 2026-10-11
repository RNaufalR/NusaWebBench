import { ERROR_CODES, type ErrorCode } from './constants.js';

/** Pemetaan kode error ke HTTP status dan pesan aman (tanpa detail internal). */
export const ERROR_CATALOG: Readonly<
  Record<ErrorCode, { httpStatus: number; safeMessage: string }>
> = Object.freeze({
  VALIDATION_FAILED: { httpStatus: 400, safeMessage: 'Data yang dikirim tidak valid.' },
  PAYLOAD_TOO_LARGE: { httpStatus: 413, safeMessage: 'Data yang dikirim terlalu besar.' },
  NOT_FOUND: { httpStatus: 404, safeMessage: 'Sumber tidak ditemukan.' },
  CONFLICT: { httpStatus: 409, safeMessage: 'Permintaan bertentangan dengan keadaan saat ini.' },
  FORBIDDEN: { httpStatus: 403, safeMessage: 'Aksi ini tidak diizinkan.' },
  SCOPE_DENIED: {
    httpStatus: 403,
    safeMessage: 'Target berada di luar cakupan yang diizinkan.',
  },
  CONSENT_REQUIRED: {
    httpStatus: 403,
    safeMessage: 'Persetujuan pengguna diperlukan sebelum aksi ini.',
  },
  LIMIT_EXCEEDED: { httpStatus: 429, safeMessage: 'Batas penggunaan lokal telah tercapai.' },
  CONFIG_INVALID: { httpStatus: 500, safeMessage: 'Konfigurasi aplikasi tidak valid.' },
  TOOL_MISSING: { httpStatus: 503, safeMessage: 'Alat yang diperlukan tidak tersedia.' },
  TOOL_FAILED: { httpStatus: 502, safeMessage: 'Alat eksternal gagal menyelesaikan tugas.' },
  TIMEOUT: { httpStatus: 504, safeMessage: 'Operasi melewati batas waktu.' },
  CANCELLED: { httpStatus: 409, safeMessage: 'Operasi dibatalkan.' },
  STORAGE_ERROR: { httpStatus: 500, safeMessage: 'Penyimpanan lokal gagal diakses.' },
  ARTIFACT_ERROR: { httpStatus: 500, safeMessage: 'Artefak gagal diproses.' },
  INTERNAL: { httpStatus: 500, safeMessage: 'Terjadi kesalahan internal.' },
});

/**
 * Error aplikasi. `safeMessage` aman ditampilkan. `debugDetail` hanya untuk log internal
 * setelah diredaksi; tidak pernah dikirim ke klien.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly safeMessage: string;
  readonly debugDetail: string | undefined;

  constructor(
    code: ErrorCode,
    options: { safeMessage?: string; debugDetail?: string; cause?: unknown } = {},
  ) {
    super(
      ERROR_CATALOG[code].safeMessage,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'AppError';
    this.code = code;
    this.safeMessage = options.safeMessage ?? ERROR_CATALOG[code].safeMessage;
    this.debugDetail = options.debugDetail;
  }
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && (ERROR_CODES as readonly string[]).includes(value);
}

/**
 * Mengubah error apa pun menjadi bentuk yang aman untuk klien. Error yang tidak dikenal
 * menjadi INTERNAL tanpa pesan asli (mencegah kebocoran stack trace atau path).
 */
export function toSafeError(err: unknown): { code: ErrorCode; message: string } {
  if (err instanceof AppError) {
    return { code: err.code, message: err.safeMessage };
  }
  return { code: 'INTERNAL', message: ERROR_CATALOG.INTERNAL.safeMessage };
}

export function httpStatusFor(code: ErrorCode): number {
  return ERROR_CATALOG[code].httpStatus;
}

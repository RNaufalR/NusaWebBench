import { describe, expect, it } from 'vitest';
import { AppError, ERROR_CATALOG, ERROR_CODES, httpStatusFor, toSafeError } from '../src/index.js';

describe('error taxonomy', () => {
  it('setiap kode error memiliki entri katalog (HTTP status dan pesan aman)', () => {
    for (const code of ERROR_CODES) {
      const entry = ERROR_CATALOG[code];
      expect(entry.httpStatus).toBeGreaterThanOrEqual(400);
      expect(entry.safeMessage.length).toBeGreaterThan(5);
      expect(httpStatusFor(code)).toBe(entry.httpStatus);
    }
  });

  it('AppError menyimpan pesan aman dan detail debug terpisah', () => {
    const err = new AppError('STORAGE_ERROR', {
      debugDetail: '/home/user/secret/db.sqlite EACCES',
    });
    expect(err.safeMessage).toBe(ERROR_CATALOG.STORAGE_ERROR.safeMessage);
    expect(err.debugDetail).toContain('EACCES');
    expect(toSafeError(err).message).not.toContain('/home/user');
  });

  it('error tak dikenal menjadi INTERNAL tanpa pesan asli (tidak bocor stack/path)', () => {
    const safe = toSafeError(new Error('ENOENT: /srv/private/key.pem'));
    expect(safe.code).toBe('INTERNAL');
    expect(safe.message).not.toContain('/srv');
    expect(JSON.stringify(toSafeError('string mentah /etc/passwd'))).not.toContain('/etc');
  });

  it('pesan aman dari AppError tidak mengandung detail debug', () => {
    const err = new AppError('TOOL_FAILED', {
      safeMessage: 'Alat gagal.',
      debugDetail: 'token=abc',
    });
    expect(toSafeError(err)).toEqual({ code: 'TOOL_FAILED', message: 'Alat gagal.' });
  });
});

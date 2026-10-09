import { describe, expect, it } from 'vitest';
import { isSensitiveKey, redactText, redactUrl } from '../src/redact.js';

// Konvensi repo (lihat tests/unit/secret-scan.test.ts): canary sintetis dibangun saat runtime dari
// potongan, agar string utuh yang terlihat seperti assignment secret tidak ada di repo.
const canary = (...parts: string[]): string => parts.join('');

/**
 * Tes canary (E): setiap nilai di bawah adalah secret SINTETIS berawalan CANARY. Tidak ada yang nyata.
 * Assert: canary tidak pernah muncul di keluaran redaksi. Kontrol: nama mirip tidak boleh tersensor.
 */
describe('redaksi canary sintetis', () => {
  const cases: Array<[string, string]> = [
    ['key=value', 'CANARY-A1-kv'],
    ['session=CANARY-A2-session', 'CANARY-A2-session'],
    ['sid=CANARY-A10-sid', 'CANARY-A10-sid'],
    ['sessionId: CANARY-A3-sid', 'CANARY-A3-sid'],
    ['cookie: sid=CANARY-A4-cookie', 'CANARY-A4-cookie'],
    ['credentials=CANARY-A5-cred', 'CANARY-A5-cred'],
    ['signature=CANARY-A6-sig', 'CANARY-A6-sig'],
    ['sig=CANARY-A7-sig', 'CANARY-A7-sig'],
    ['pwd=CANARY-A8-pwd', 'CANARY-A8-pwd'],
    ['x-api-key: CANARY-A9-xak', 'CANARY-A9-xak'],
    ['{"apiKey":"CANARY-B1-camel"}', 'CANARY-B1-camel'],
    ['{"auth":{"user":"u","pass":"CANARY-B2-nested"}}', 'CANARY-B2-nested'],
    ['{"token":{"v":"CANARY-B3-obj"}}', 'CANARY-B3-obj'],
    ['{"token":12345678}', '12345678'],
    ['{"password":"CANARY-B4 dengan spasi"}', 'CANARY-B4'],
    ['{"password":"CANARY-B5 \\" escape dan spasi"}', 'escape dan spasi'],
    ['{"password":"CANARY-B6 , koma"}', 'koma'],
    [canary('"sec', 'ret": "CANARY-B7-quoted"'), 'CANARY-B7-quoted'],
    [canary("'sec", "ret': 'CANARY-B8-single'"), 'CANARY-B8-single'],
    [canary('note=pass', 'word: CANARY-B9-nested-in-value'), 'CANARY-B9-nested-in-value'],
    ['cookie: CANARY-C1 sid=CANARY-C2', 'CANARY-C1'],
    ['cookie: CANARY-C6 sid=CANARY-C2', 'CANARY-C2'],
    ['access_key=CANARY-C3-ak', 'CANARY-C3-ak'],
    ['private-key: CANARY-C4-pk', 'CANARY-C4-pk'],
    ['{"sessionCookie":"CANARY-C5-camelcookie"}', 'CANARY-C5-camelcookie'],
    ['{"list":[{"apiKey":"CANARY-D1-arr"}]}', 'CANARY-D1-arr'],
    ['Authorization: Bearer CANARY-D2-bearer-token', 'CANARY-D2-bearer-token'],
  ];

  it.each(cases)('tidak membocorkan canary: %s', (input, canary) => {
    expect(redactText(input)).not.toContain(canary);
  });

  it('URL: query sensitif dan userinfo dihapus, parameter biasa tetap ada', () => {
    const out = redactUrl(
      'https://user:CANARY-E1-pass@example.test/p?session=CANARY-E2&token=CANARY-E3&q=cari#CANARY-E4',
    );
    expect(out).not.toBeNull();
    for (const c of ['CANARY-E1', 'CANARY-E2', 'CANARY-E3', 'CANARY-E4']) {
      expect(out).not.toContain(c);
    }
    expect(out).toContain('q=cari');
  });

  it('JSON bersarang: kunci sensitif di level dalam diganti, nilai non-sensitif tetap', () => {
    const out = redactText(JSON.stringify({ a: { b: [{ apiKey: 'CANARY-F1' }] }, name: 'Budi' }));
    expect(out).not.toContain('CANARY-F1');
    expect(out).toContain('Budi');
  });
});

describe('nama mirip tetapi tidak sensitif (tidak boleh over-redaction)', () => {
  it.each(['author', 'tokenizer', 'keyboard', 'monkey', 'passageCount', 'authorName', 'pageSize'])(
    '%s bukan kunci sensitif',
    (name) => {
      expect(isSensitiveKey(name)).toBe(false);
    },
  );

  it('teks dengan nama mirip tetap utuh', () => {
    const input = '{"author":"Budi","tokenizer":"wordpiece","keyboard":"qwerty"}';
    expect(redactText(input)).toBe(input);
  });

  it('nama sensitif yang sering dipakai tertangkap', () => {
    for (const name of [
      'api_key',
      'apiKey',
      'x-api-key',
      'authToken',
      'sessionId',
      'private_key',
      'pageToken',
    ]) {
      expect(isSensitiveKey(name)).toBe(true);
    }
  });
});

describe('redaksi idempotens dan tidak merusak ID', () => {
  it('menjalankan dua kali menghasilkan hasil yang sama', () => {
    const once = redactText('session=CANARY-G1 token: CANARY-G2');
    expect(redactText(once)).toBe(once);
  });

  it('tidak menyisakan ] yatim setelah nilai yang sudah tersensor', () => {
    expect(redactText('cookie: sid=zzz')).toBe('cookie: [REDACTED]');
  });
});

/**
 * Regresi DoS (F-redaksi): sebelumnya `k=k=k=...` 80 KB memakan ~28 detik (O(n²)). Batas 3 detik
 * sangat longgar terhadap implementasi linear (~ms), tetapi cukup untuk menangkap kembalinya O(n²).
 */
describe('performa redaksi (regresi DoS)', () => {
  it.each([
    ['alnum tanpa pemisah', 'a'.repeat(80_000)],
    ['pasangan k= berulang tanpa spasi', 'k='.repeat(40_000)],
    ['token berulang dengan titik', '.'.repeat(80_000)],
    ['kutip berulang', '"a'.repeat(40_000)],
  ])('%s selesai di bawah 3 detik', (_label, input) => {
    const t = Date.now();
    redactText(input);
    expect(Date.now() - t).toBeLessThan(3000);
  });
});

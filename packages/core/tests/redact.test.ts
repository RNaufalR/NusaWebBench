import { describe, expect, it } from 'vitest';
import { containsKnownSecret, redactText, redactUrl } from '../src/index.js';

// Canary sintetis: dibangun saat runtime agar string utuh tidak ada di repo.
const c = (...p: string[]) => p.join('');
const GOOGLE = c('AI', 'za', 'SyD', '0123456789abcdefGHIJKLMNOPQRSTUV');
const GROQ = c('gs', 'k_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0U1v2');
const BEARER = c('Bear', 'er ', 'abcdef1234567890XYZ');

describe('redactText', () => {
  it('menghapus nilai key provider berbentuk tetap', () => {
    const out = redactText(`key=${GOOGLE} dan ${GROQ}`);
    expect(out).not.toContain(GOOGLE);
    expect(out).not.toContain(GROQ);
    expect(out).toContain('[REDACTED:GOOGLE_API_KEY]');
    expect(out).toContain('[REDACTED:GROQ_API_KEY]');
  });

  it('menghapus Authorization dan Cookie header', () => {
    const out = redactText(`Authorization: ${BEARER}\nCookie: session=abc123\nSet-Cookie: id=zzz`);
    expect(out).not.toContain('XYZ');
    expect(out).not.toContain('abc123');
    expect(out).not.toContain('zzz');
    expect(out).toMatch(/Authorization: \[REDACTED\]/);
  });

  it('menghapus nilai bearer di luar header', () => {
    expect(redactText(`pesan: ${BEARER}`)).not.toContain('XYZ');
  });

  it('memaskan pasangan name=value dan JSON untuk nama sensitif', () => {
    const out = redactText(
      ['GEMINI_API_KEY=abcdefgh', 'ijklmnop && {"password": "hunter2hunter2"}'].join(''),
    );
    expect(out).not.toContain('abcdefghijklmnop');
    expect(out).not.toContain('hunter2hunter2');
    expect(out).toContain('[REDACTED]');
  });

  it('memaskan email dan nomor identitas 16 digit', () => {
    const out = redactText('kontak: budi@example.co.id, NIK 3271012345678901 dan angka 12345');
    expect(out).not.toContain('budi@example');
    expect(out).not.toContain('3271012345678901');
    expect(out).toContain('12345');
  });

  it('membiarkan teks biasa tidak berubah', () => {
    const plain = 'Halaman memuat 3 gambar dan 2 tautan.';
    expect(redactText(plain)).toBe(plain);
  });

  it('menghapus blok PEM private key', () => {
    const pem = c(
      '-----BEGIN ',
      'PRIVATE KEY',
      '-----\nMIIEvQ==\n-----END ',
      'PRIVATE KEY',
      '-----',
    );
    expect(redactText(pem)).not.toContain('MIIEvQ==');
  });
});

describe('redactUrl', () => {
  it('menghapus userinfo dan fragment', () => {
    expect(redactUrl('https://user:pw@example.com/a#frag')).toBe('https://example.com/a');
  });

  it('memaskan query parameter sensitif dan mempertahankan parameter biasa', () => {
    const out = redactUrl('https://example.com/?page=2&access_token=abc&q=test');
    expect(out).toContain('page=2');
    expect(out).toContain('q=test');
    expect(out).not.toContain('abc');
    expect(out).toContain('access_token=%5BREDACTED%5D');
  });

  it('mengembalikan null untuk input yang bukan URL (tidak menampilkan input mentah)', () => {
    expect(redactUrl('bukan url /rahasia')).toBeNull();
  });
});

describe('containsKnownSecret', () => {
  it('mendeteksi canary dan tidak mendeteksi teks normal', () => {
    expect(containsKnownSecret(`x ${GROQ}`)).toBe(true);
    expect(containsKnownSecret(`x ${GROQ}`)).toBe(true); // stateless (regex lastIndex direset)
    expect(containsKnownSecret('tidak ada rahasia')).toBe(false);
  });
});

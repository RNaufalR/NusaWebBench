import { describe, expect, it } from 'vitest';
import { redactText } from '../src/index.js';

// Semua nilai di bawah SINTETIS (canary). Dibangun dengan penggabungan agar tidak cocok dengan
// pemindai secret repo sebagai token nyata.
const OR_KEY = ['sk-or-v1-', 'a'.repeat(40)].join('');
const ANT_KEY = ['sk-ant-api03-', 'b'.repeat(40)].join('');
const STRIPE_KEY = ['sk_', 'live_', 'c'.repeat(24)].join('');
const SLACK_KEY = ['xoxb', '-1234567890-', 'abcdefghijkl'].join('');

describe('redaksi: nilai bertanda kutip dengan spasi atau koma (regresi)', () => {
  it('menyensor JSON password yang memuat spasi', () => {
    const out = redactText('{"password": "hunter two"}');
    expect(out).not.toContain('hunter');
    expect(out).not.toContain('two');
    expect(out).toBe('{"password": "[REDACTED]"}');
  });

  it('menyensor JSON secret yang memuat koma', () => {
    const out = redactText('{"password":"a,b-secret-zz"}');
    expect(out).not.toContain('secret-zz');
    expect(out).toBe('{"password":"[REDACTED]"}');
  });

  it('menyensor nilai bertanda kutip tunggal dengan spasi', () => {
    const out = redactText("token='abc def ghi'");
    expect(out).not.toContain('def');
    expect(out).toBe("token='[REDACTED]'");
  });

  it('nilai tanpa kutip tetap disensor dan tidak mengubah teks biasa', () => {
    expect(redactText('api_key=abc123xyz')).toBe('api_key=[REDACTED]');
    expect(redactText('Halaman reset password tersedia.')).toBe('Halaman reset password tersedia.');
  });
});

describe('redaksi: format kunci provider tambahan (regresi)', () => {
  it.each([
    ['OpenRouter/OpenAI-style', `pakai ${OR_KEY} di sini`],
    ['Anthropic-style', `kunci ${ANT_KEY}`],
    ['Stripe-style', `nilai ${STRIPE_KEY}`],
    ['Slack', `token ${SLACK_KEY} lama`],
  ])('menyensor %s tanpa nama field', (_label, input) => {
    const out = redactText(input);
    expect(out).toContain('[REDACTED:');
    expect(out).not.toMatch(/sk-or-v1-a{10}|sk-ant-api03-b{10}|sk_live_c{10}|xoxb-1234567890/);
  });
});

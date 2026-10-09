import { describe, expect, it } from 'vitest';
import { CHROME_BASE_FLAGS, chromeFlagsFromEnv, proxyFlags } from '../src/lighthouse.js';

/**
 * F-06: flag egress. Ini hanya memeriksa susunan flag. Perilaku runtime dibuktikan oleh
 * `egress-integration.test.ts` dengan Chromium nyata.
 */
describe('flag egress Lighthouse (F-06)', () => {
  it('semua request lewat proxy per run, termasuk loopback (<-loopback>)', () => {
    const flags = proxyFlags('http://127.0.0.1:40000');
    expect(flags).toContain('--proxy-server=http://127.0.0.1:40000');
    expect(flags).toContain('--proxy-bypass-list=<-loopback>');
  });

  it('tidak ada bypass loopback eksplisit yang meloloskan request langsung', () => {
    const flags = chromeFlagsFromEnv({}, 'http://127.0.0.1:40000');
    expect(flags.some((f) => f.startsWith('--proxy-bypass-list=') && f.includes('localhost'))).toBe(
      false,
    );
    expect(flags.some((f) => f.includes('127.0.0.1;'))).toBe(false);
  });

  it('flag dasar tidak memuat proxy tetap (tidak ada proxy mati lama)', () => {
    expect(CHROME_BASE_FLAGS.some((f) => f.startsWith('--proxy-'))).toBe(false);
  });

  it('flag proxy tetap ada saat sandbox dinonaktifkan dari env', () => {
    const flags = chromeFlagsFromEnv({ NWB_CHROME_NO_SANDBOX: '1' }, 'http://127.0.0.1:40000');
    expect(flags).toContain('--proxy-bypass-list=<-loopback>');
    expect(flags).toContain('--no-sandbox');
  });
});

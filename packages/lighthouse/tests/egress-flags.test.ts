import { describe, expect, it } from 'vitest';
import { CHROME_FLAGS, LIGHTHOUSE_DEAD_PROXY, chromeFlagsFromEnv } from '../src/lighthouse.js';

/** F-06: IP literal tidak melewati host-resolver-rules. Harus ada proxy mati untuk non-loopback. */
describe('flag egress Lighthouse (F-06)', () => {
  it('mengarahkan koneksi non-loopback ke proxy yang tidak aktif', () => {
    expect(CHROME_FLAGS).toContain(`--proxy-server=${LIGHTHOUSE_DEAD_PROXY}`);
    expect(LIGHTHOUSE_DEAD_PROXY).toBe('http://127.0.0.1:1');
  });

  it('bypass hanya loopback', () => {
    expect(CHROME_FLAGS).toContain('--proxy-bypass-list=localhost;127.0.0.1;[::1]');
  });

  it('flag proxy tetap ada saat sandbox dinonaktifkan dari env', () => {
    const flags = chromeFlagsFromEnv({ NWB_CHROME_NO_SANDBOX: '1' });
    expect(flags.some((f) => f.startsWith('--proxy-server='))).toBe(true);
    expect(flags).toContain('--no-sandbox');
  });
});

import { describe, expect, it } from 'vitest';
import { CHROME_FLAGS, chromeFlagsFromEnv } from '../src/lighthouse.js';

describe('flag Chrome (R-LH-1)', () => {
  it('default: sandbox Chrome aktif (tanpa --no-sandbox)', () => {
    expect(CHROME_FLAGS).not.toContain('--no-sandbox');
    expect(chromeFlagsFromEnv({})).not.toContain('--no-sandbox');
  });

  it('--no-sandbox hanya bila NWB_CHROME_NO_SANDBOX=1 secara eksplisit', () => {
    expect(chromeFlagsFromEnv({ NWB_CHROME_NO_SANDBOX: '1' })).toContain('--no-sandbox');
    expect(chromeFlagsFromEnv({ NWB_CHROME_NO_SANDBOX: 'true' })).not.toContain('--no-sandbox');
  });
});

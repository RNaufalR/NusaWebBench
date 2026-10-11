import { describe, expect, it } from 'vitest';
import { chromeFlagsFromEnv } from '../src/lighthouse.js';

const PROXY = 'http://127.0.0.1:40000';

describe('flag Chrome (R-LH-1)', () => {
  it('default: sandbox Chrome aktif (tanpa --no-sandbox)', () => {
    expect(chromeFlagsFromEnv({}, PROXY)).not.toContain('--no-sandbox');
  });

  it('--no-sandbox hanya bila NWB_CHROME_NO_SANDBOX=1 secara eksplisit', () => {
    expect(chromeFlagsFromEnv({ NWB_CHROME_NO_SANDBOX: '1' }, PROXY)).toContain('--no-sandbox');
    expect(chromeFlagsFromEnv({ NWB_CHROME_NO_SANDBOX: 'true' }, PROXY)).not.toContain(
      '--no-sandbox',
    );
  });
});

import { describe, expect, it, vi } from 'vitest';
import type { ScopeGrant } from '@nusawebbench/core';
import type { Request as PwRequest, Route } from 'playwright-core';
import {
  createRouteGuard,
  isRiskyClickLabel,
  normalizeLinkCandidates,
  parseFunctionalQaConfig,
} from '../src/index.js';

const grant: ScopeGrant = { origin: 'http://127.0.0.1:4178', mode: 'local-fixture' };

function fakeRoute() {
  return {
    continue: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
  };
}

function fakeRequest(url: string): PwRequest {
  return { url: () => url } as unknown as PwRequest;
}

describe('parseFunctionalQaConfig', () => {
  it('memakai default aman bila konfigurasi kosong', () => {
    const cfg = parseFunctionalQaConfig(undefined);
    expect(cfg.startPath).toBe('/');
    expect(cfg.maxPages).toBe(5);
    expect(cfg.maxDepth).toBe(1);
    expect(cfg.flows).toEqual([]);
  });

  it('menolak path traversal dan URL absolut sebagai startPath', () => {
    expect(() => parseFunctionalQaConfig({ startPath: '../etc/passwd' })).toThrow();
    expect(() => parseFunctionalQaConfig({ startPath: 'https://example.com/' })).toThrow();
  });

  it('menolak batas di luar rentang dan kunci tidak dikenal', () => {
    expect(() => parseFunctionalQaConfig({ maxPages: 11 })).toThrow();
    expect(() => parseFunctionalQaConfig({ maxDepth: 3 })).toThrow();
    expect(() => parseFunctionalQaConfig({ unknownKey: true })).toThrow();
  });

  it('menolak langkah alur dengan aksi tidak dikenal', () => {
    expect(() =>
      parseFunctionalQaConfig({
        flows: [{ name: 'x', steps: [{ action: 'submitForm', selector: 'form' }] }],
      }),
    ).toThrow();
  });

  it('galat konfigurasi tidak memuat nilai masukan', () => {
    try {
      parseFunctionalQaConfig({ startPath: 'rahasia-jangan-tampil/../x', maxPages: 99 });
      throw new Error('seharusnya gagal');
    } catch (err) {
      expect(String(err)).not.toContain('rahasia-jangan-tampil');
    }
  });
});

describe('isRiskyClickLabel', () => {
  it('menandai tombol aksi berisiko', () => {
    expect(isRiskyClickLabel('Bayar sekarang')).toBe(true);
    expect(isRiskyClickLabel('Hapus akun')).toBe(true);
    expect(isRiskyClickLabel('Checkout')).toBe(true);
  });

  it('membiarkan tombol aman', () => {
    expect(isRiskyClickLabel('Muat data')).toBe(false);
    expect(isRiskyClickLabel('Produk')).toBe(false);
  });
});

describe('normalizeLinkCandidates', () => {
  const origin = 'http://127.0.0.1:4178';
  it('menerima tautan relatif dan absolut satu origin, membuang skema lain dan fragmen', () => {
    const out = normalizeLinkCandidates(
      [
        '/products.html',
        'products.html#bagian',
        'http://127.0.0.1:4178/about.html',
        'https://contoh.invalid/',
        'mailto:admin@contoh.invalid',
        'javascript:alert(1)',
        'tel:+6200000',
        '',
      ],
      `${origin}/index.html`,
      origin,
    );
    expect(out).toEqual([`${origin}/products.html`, `${origin}/about.html`]);
  });
});

describe('createRouteGuard', () => {
  it('melanjutkan permintaan dalam scope dan memblokir di luar scope', async () => {
    const stats = { blocked: 0 };
    const guard = createRouteGuard(grant, stats);

    const ok = fakeRoute();
    await guard(ok as unknown as Route, fakeRequest(`${grant.origin}/app.js`));
    expect(ok.continue).toHaveBeenCalledTimes(1);
    expect(ok.abort).not.toHaveBeenCalled();

    const external = fakeRoute();
    await guard(external as unknown as Route, fakeRequest('http://example.com/tracker.js'));
    expect(external.abort).toHaveBeenCalledWith('blockedbyclient');

    const fileScheme = fakeRoute();
    await guard(fileScheme as unknown as Route, fakeRequest('file:///etc/passwd'));
    expect(fileScheme.abort).toHaveBeenCalledWith('blockedbyclient');

    const creds = fakeRoute();
    await guard(creds as unknown as Route, fakeRequest('http://user:pw@127.0.0.1:4178/'));
    expect(creds.abort).toHaveBeenCalledWith('blockedbyclient');

    expect(stats.blocked).toBe(3);
  });
});

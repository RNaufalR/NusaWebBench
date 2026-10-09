import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * F-05 — runtime Chromium untuk pin DNS (`--host-resolver-rules=MAP host ip,MAP * ~NOTFOUND`).
 *
 * Hostname `pinned.test` dan `other.test` tidak memiliki record DNS. Halaman hanya bisa termuat bila
 * Chrome memakai pin, bukan DNS. Host lain harus gagal dengan NOTFOUND dan tidak menyentuh server.
 */
const BROWSER = process.env['CHROMIUM_PATH'];
const REQUIRE = process.env['REQUIRE_BROWSER_TESTS'] === '1';
if (REQUIRE && !BROWSER) {
  throw new Error(
    'REQUIRE_BROWSER_TESTS=1 tetapi CHROMIUM_PATH kosong: tes browser tidak boleh dilewati.',
  );
}

let server: Server;
let port = 0;
const seenHosts: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    seenHosts.push(String(req.headers.host ?? ''));
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>pinned</title><h1>pinned-ok</h1>');
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

const describeBrowser = BROWSER ? describe : describe.skip;

describeBrowser('pin DNS di Chromium nyata (F-05 runtime)', () => {
  let browser: Browser;
  beforeAll(async () => {
    if (!BROWSER) throw new Error('CHROMIUM_PATH belum diset');
    browser = await chromium.launch({
      executablePath: BROWSER,
      headless: true,
      args: ['--host-resolver-rules=MAP pinned.test 127.0.0.1,MAP * ~NOTFOUND'],
    });
  });
  afterAll(async () => {
    await browser?.close();
  });

  it('host yang dipin dimuat ke alamat terpin tanpa DNS', async () => {
    const page = await browser.newPage();
    const before = seenHosts.length;
    const res = await page.goto(`http://pinned.test:${port}/`, { waitUntil: 'load' });
    expect(res?.status()).toBe(200);
    expect(await page.textContent('h1')).toBe('pinned-ok');
    expect(seenHosts.length).toBe(before + 1);
    // Host header tetap nama asli (bukan IP), sehingga virtual host dan SNI bekerja.
    expect(seenHosts.at(-1)).toBe(`pinned.test:${port}`);
    await page.close();
  });

  it('host lain yang tidak dipin gagal NOTFOUND dan tidak menyentuh server', async () => {
    const page = await browser.newPage();
    const before = seenHosts.length;
    const err = await page.goto(`http://other.test:${port}/`).then(
      () => null,
      (e: Error) => e.message,
    );
    expect(err).toMatch(/ERR_NAME_NOT_RESOLVED|NAME_NOT_RESOLVED/);
    expect(seenHosts.length).toBe(before);
    await page.close();
  });

  it('IP literal yang tidak dipin juga NOTFOUND (fail-closed: redirect ke IP tidak bisa lolos pin)', async () => {
    const page = await browser.newPage();
    const before = seenHosts.length;
    const err = await page.goto(`http://127.0.0.1:${port}/`).then(
      () => null,
      (e: Error) => e.message,
    );
    // Aturan `MAP * ~NOTFOUND` berlaku juga untuk IP literal di Chromium 153 (diuji 2026-10-09).
    expect(err).toMatch(/ERR_NAME_NOT_RESOLVED/);
    expect(seenHosts.length).toBe(before);
    await page.close();
  });
});

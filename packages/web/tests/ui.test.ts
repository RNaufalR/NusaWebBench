import { mkdtempSync, rmSync } from 'node:fs';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig } from '@nusawebbench/core';
import { BROWSER_ARGS } from '@nusawebbench/browser-qa';
import { RunOrchestrator } from '@nusawebbench/orchestrator';
import { AiService, AiSettingsService } from '@nusawebbench/ai';
import { ArtifactStore, Store } from '@nusawebbench/storage';
import { chromium, type Browser, type Page } from 'playwright-core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, startServer } from '../src/index.js';

/**
 * Menunggu teks status tanpa `waitForFunction` berbasis string. Predikat string dievaluasi di halaman
 * dan CSP dashboard (`script-src 'self'`, tanpa 'unsafe-eval') memblokirnya saat polling (R-TEST-2).
 * Locator Playwright tidak memakai evaluasi string di halaman.
 */
async function waitForStatus(page: Page, text: string): Promise<void> {
  await page.locator('#status').filter({ hasText: text }).waitFor({ timeout: 15_000 });
}

const BROWSER = process.env['CHROMIUM_PATH'];
const REQUIRE = process.env['REQUIRE_BROWSER_TESTS'] === '1';
if (REQUIRE && !BROWSER) throw new Error('REQUIRE_BROWSER_TESTS=1 tetapi CHROMIUM_PATH kosong.');
const real = BROWSER ? describe : describe.skip;

let dir: string;
let store: Store;
let server: Server;
let base = '';
let browser: Browser;

beforeAll(async () => {
  if (!BROWSER) return;
  dir = mkdtempSync(path.join(tmpdir(), 'nwb-ui-'));
  store = Store.open(path.join(dir, 'db.sqlite'));
  const artifacts = new ArtifactStore({ rootDir: path.join(dir, 'a'), evidence: store.evidence });
  const config = loadConfig({});
  const app = createApp({
    store,
    artifacts,
    orchestrator: new RunOrchestrator({ store, adapters: [] }),
    aiSettings: new AiSettingsService(store, config),
    aiService: new AiService({ store, config, clients: {} }),
    allowedHosts: ['127.0.0.1', 'localhost'],
  });
  server = await startServer(app.handle, { host: '127.0.0.1', port: 0 });
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  browser = await chromium.launch({
    executablePath: BROWSER,
    headless: true,
    args: [...BROWSER_ARGS],
  });
});

afterAll(async () => {
  if (!BROWSER) return;
  await browser?.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

real('dashboard di Chromium nyata', () => {
  it('memuat tanpa error konsol; status berubah menjadi siap', async () => {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(`console: ${m.text()}`);
    });
    await page.goto(base + '/', { waitUntil: 'load' });
    await waitForStatus(page, 'Siap.');
    expect(errors).toEqual([]);
    await page.close();
  }, 60_000);

  it('navigasi keyboard: Tab pertama mencapai tautan lewati, lalu form target dapat diisi dan dikirim', async () => {
    const page = await browser.newPage();
    await page.goto(base + '/', { waitUntil: 'load' });
    await waitForStatus(page, 'Siap.');
    await page.keyboard.press('Tab');
    const first = await page.evaluate(
      "document.activeElement ? document.activeElement.className : ''",
    );
    expect(first).toBe('skip');
    await page.getByLabel('Nama').fill('<b>Uji UI</b>');
    await page.getByLabel('Origin').fill('http://127.0.0.1:9999');
    await page.getByRole('button', { name: 'Tambah target' }).click();
    await waitForStatus(page, 'Target ditambahkan.');
    // Markup dari data harus tampil sebagai teks, bukan elemen HTML.
    const literal = await page.locator('#targets td').first().textContent();
    expect(literal).toBe('<b>Uji UI</b>');
    expect(await page.locator('#targets b').count()).toBe(0);
    await page.close();
  }, 60_000);
});

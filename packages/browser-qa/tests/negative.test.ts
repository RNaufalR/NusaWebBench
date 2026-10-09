import { mkdtempSync, rmSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTarget, type ScopeGrant } from '@nusawebbench/core';
import { RunOrchestrator, type ModuleContext } from '@nusawebbench/orchestrator';
import { ArtifactStore, Store } from '@nusawebbench/storage';
import { chromium, type Browser } from 'playwright-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FunctionalQaAdapter, type FunctionalQaConfig } from '../src/index.js';

/**
 * Tes negatif terhadap situs uji lokal (127.0.0.1). Origin "eksternal" adalah server lokal
 * kedua dengan port berbeda; setiap hit ke server itu berarti kebijakan scope gagal.
 * Tes ini butuh Chromium nyata (`CHROMIUM_PATH`); tanpa itu, blok dilewati (SKIPPED).
 */
const BROWSER_PATH = process.env['CHROMIUM_PATH'];
const hasBrowser = typeof BROWSER_PATH === 'string' && BROWSER_PATH.length > 0;
const TIMEOUT_MS = 90_000;

type Site = {
  origin: string;
  external: string;
  externalHits: () => number;
  /** Jumlah request ke aplikasi per path (untuk membuktikan bahwa form tidak dikirim). */
  hits: Map<string, number>;
  postHits: () => number;
  pending: http.ServerResponse[];
  close: () => Promise<void>;
};

const FORM_AND_LINKS = (ext: string) => `<!doctype html>
<html lang="id"><head><meta charset="utf-8"><title>Uji negatif</title>
<img src="${ext}/pixel.png" alt="piksel eksternal">
</head><body>
<main>
  <h1>Uji negatif</h1>
  <a href="/a.html">A</a>
  <a href="/a.html#duplikat">A (duplikat)</a>
  <a href="/redir">Redirect keluar scope</a>
  <a href="/gone">Tautan rusak</a>
  <img src="/socket-drop" alt="gagal jaringan">
  <script>
    console.error('Authorization: Bearer abcdefghijklmnop123456 debug');
    fetch('${ext}/track').catch(() => undefined);
  </script>
  <form action="/submit-real" method="post">
    <input id="email" type="email" required>
    <input id="pw" type="password">
    <input id="name" type="text">
    <button id="lanjut" type="submit">Lanjut</button>
  </form>
</main>
</body></html>`;

async function startSite(): Promise<Site> {
  let extHits = 0;
  const external = http.createServer((_req, res) => {
    extHits += 1;
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('eksternal');
  });
  await new Promise<void>((r) => external.listen(0, '127.0.0.1', () => r()));
  const extOrigin = `http://127.0.0.1:${(external.address() as AddressInfo).port}`;

  const pending: http.ServerResponse[] = [];
  const hits = new Map<string, number>();
  let postCount = 0;
  const app = http.createServer((req, res) => {
    const url = req.url ?? '/';
    if (req.method === 'POST') postCount += 1;
    hits.set(url, (hits.get(url) ?? 0) + 1);
    if (url === '/many') {
      // Banyak tautan yang gagal di transport: mengukur batas percobaan navigasi.
      const links = Array.from(
        { length: 30 },
        (_v, i) => `<a href="/socket-drop?n=${i}">t${i}</a>`,
      ).join('');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><title>Banyak tautan</title><main>${links}</main>`);
      return;
    }
    if (url === '/' || url.startsWith('/?')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(FORM_AND_LINKS(extOrigin));
      return;
    }
    if (url === '/a.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>A</title><h1>A</h1>');
      return;
    }
    if (url === '/redir') {
      res.writeHead(302, { location: `${extOrigin}/landing` });
      res.end();
      return;
    }
    if (url.startsWith('/socket-drop')) {
      req.socket.destroy();
      return;
    }
    if (url === '/hang') {
      pending.push(res); // tidak pernah dijawab: uji timeout navigasi
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('tidak ditemukan');
  });
  await new Promise<void>((r) => app.listen(0, '127.0.0.1', () => r()));
  const origin = `http://127.0.0.1:${(app.address() as AddressInfo).port}`;

  return {
    origin,
    external: extOrigin,
    externalHits: () => extHits,
    hits,
    postHits: () => postCount,
    pending,
    close: async () => {
      app.closeAllConnections();
      external.closeAllConnections();
      await Promise.all([
        new Promise<void>((r) => app.close(() => r())),
        new Promise<void>((r) => external.close(() => r())),
      ]);
    },
  };
}

describe.skipIf(!hasBrowser)('FunctionalQaAdapter — tes negatif dengan Chromium nyata', () => {
  let dir: string;
  let store: Store;
  let artifacts: ArtifactStore;
  let site: Site | undefined;
  let launched: Browser[];

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'nwb-qa-neg-'));
    store = Store.open(path.join(dir, 'test.sqlite'));
    artifacts = new ArtifactStore({
      rootDir: path.join(dir, 'artifacts'),
      evidence: store.evidence,
    });
    launched = [];
  });

  afterEach(async () => {
    for (const p of site?.pending ?? []) p.destroy();
    await site?.close();
    site = undefined;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  /** Membuat run di storage (agar FK artefak valid) lalu menjalankan adapter secara langsung. */
  async function run(
    config: FunctionalQaConfig | unknown,
    opts: { abortAfterMs?: number; artifactsOverride?: ArtifactStore } = {},
  ) {
    site = await startSite();
    const grant: ScopeGrant = { origin: site.origin, mode: 'local-fixture' };
    const target = createTarget({
      label: 'uji negatif',
      origin: site.origin,
      mode: 'fixture',
      allowedModules: [],
      scopeConfirmedAt: null,
    });
    store.targets.insert(target);
    // Adapter terdaftar agar orchestrator menerima modul; eksekusi tetap dipanggil langsung di bawah.
    const orch = new RunOrchestrator({
      store,
      adapters: [new FunctionalQaAdapter({ artifacts })],
    });
    const runRecord = orch.createRun({
      target,
      grant,
      modules: ['FUNCTIONAL_QA'],
      acknowledged: true,
    });
    const controller = new AbortController();
    const timer =
      opts.abortAfterMs !== undefined
        ? setTimeout(() => controller.abort(), opts.abortAfterMs)
        : undefined;
    const ctx: ModuleContext = {
      runId: runRecord.id,
      moduleResultId: `mod_${'a'.repeat(32)}`,
      targetOrigin: site.origin,
      grant,
      signal: controller.signal,
      progress: () => undefined,
    };
    const adapter = new FunctionalQaAdapter({
      artifacts: opts.artifactsOverride ?? artifacts,
      config,
      executablePath: BROWSER_PATH,
      launch: async (o) => {
        const b = await chromium.launch(o);
        launched.push(b);
        return b;
      },
    });
    try {
      return await adapter.run(ctx);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  it(
    'origin eksternal diblokir: tidak ada hit ke server eksternal, dan blokir tercatat',
    async () => {
      const out = await run({ startPath: '/', maxDepth: 0, linkCheckLimit: 10 });
      expect(site?.externalHits()).toBe(0);
      expect(out.metrics?.['requestsBlocked']).toBeGreaterThanOrEqual(2);
      expect(out.status).toBe('FAIL');
      // Semua browser yang dibuka harus sudah tertutup setelah run selesai.
      expect(launched.every((b) => !b.isConnected())).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'redirect keluar scope tidak diikuti; tautan rusak dan request gagal dilaporkan',
    async () => {
      const out = await run({ startPath: '/', maxDepth: 0, linkCheckLimit: 10 });
      expect(out.metrics?.['linksRedirectDenied']).toBeGreaterThanOrEqual(1);
      expect(site?.externalHits()).toBe(0);
      const rules = (out.findings ?? []).map((f) => f.ruleId);
      expect(rules).toContain('qa-broken-link');
      expect(rules).toContain('qa-request-failed');
      const broken = (out.findings ?? []).find((f) => f.ruleId === 'qa-broken-link');
      expect(broken?.description).toContain('/gone');
    },
    TIMEOUT_MS,
  );

  it(
    'duplikat tautan dan favicon 404 tidak menghasilkan temuan tambahan',
    async () => {
      const out = await run({ startPath: '/', maxDepth: 0, linkCheckLimit: 50 });
      // /a.html muncul dua kali (dengan dan tanpa fragmen) tetapi hanya dicek sekali.
      const linkChecks = out.metrics?.['linksChecked'] ?? 0;
      expect(linkChecks).toBeLessThanOrEqual(6);
      const descriptions = (out.findings ?? []).map((f) => f.description);
      expect(descriptions.some((d) => d.includes('favicon'))).toBe(false);
    },
    TIMEOUT_MS,
  );

  it(
    'secret di pesan konsol diredaksi; nilai asli tidak muncul di temuan',
    async () => {
      const out = await run({ startPath: '/', maxDepth: 0, linkCheckLimit: 0 });
      const consoleFindings = (out.findings ?? []).filter((f) => f.ruleId === 'qa-console-error');
      expect(consoleFindings.length).toBeGreaterThan(0);
      const serialized = JSON.stringify(out.findings ?? []);
      expect(serialized).not.toContain('abcdefghijklmnop123456');
      expect(serialized).toContain('[REDACTED');
    },
    TIMEOUT_MS,
  );

  it(
    'timeout navigasi halaman awal menghasilkan ERROR TIMEOUT (retryable), bukan PASS',
    async () => {
      const out = await run({ startPath: '/hang', navigationTimeoutMs: 1000, maxDepth: 0 });
      expect(out.status).toBe('ERROR');
      expect(out.errorCode).toBe('TIMEOUT');
      expect(out.retryable).toBe(true);
      expect(launched.every((b) => !b.isConnected())).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'pembatalan di tengah run menutup browser dan menghasilkan CANCELLED',
    async () => {
      const started = Date.now();
      const out = await run(
        { startPath: '/hang', navigationTimeoutMs: 30000, maxDepth: 0 },
        { abortAfterMs: 800 },
      );
      expect(out.status).toBe('ERROR');
      expect(out.errorCode).toBe('CANCELLED');
      expect(Date.now() - started).toBeLessThan(20_000);
      expect(launched.length).toBeGreaterThan(0);
      expect(launched.every((b) => !b.isConnected())).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'form diisi data dummy; validitas diperiksa; langkah sesuai harapan berstatus PASS',
    async () => {
      const out = await run({
        startPath: '/',
        maxDepth: 0,
        linkCheckLimit: 0,
        flows: [
          {
            name: 'form-dummy',
            steps: [
              { action: 'fillDummy', selector: '#name' },
              { action: 'expectValidity', selector: '#email', valid: false },
              { action: 'expectPath', path: '/' },
            ],
          },
        ],
      });
      expect(out.metrics?.['flowsRun']).toBe(1);
      expect(out.metrics?.['flowsFailed']).toBe(0);
      expect((out.findings ?? []).some((f) => f.ruleId === 'qa-flow-assertion')).toBe(false);
    },
    TIMEOUT_MS,
  );

  it(
    'isian password ditolak sebagai langkah berisiko (ERROR VALIDATION_FAILED)',
    async () => {
      const out = await run({
        startPath: '/',
        maxDepth: 0,
        linkCheckLimit: 0,
        flows: [{ name: 'pw', steps: [{ action: 'fillDummy', selector: '#pw' }] }],
      });
      expect(out.status).toBe('ERROR');
      expect(out.errorCode).toBe('VALIDATION_FAILED');
    },
    TIMEOUT_MS,
  );

  it(
    'asersi path yang salah menjadi temuan qa-flow-assertion',
    async () => {
      const out = await run({
        startPath: '/',
        maxDepth: 0,
        linkCheckLimit: 0,
        flows: [{ name: 'path', steps: [{ action: 'expectPath', path: '/tidak-ada' }] }],
      });
      expect((out.findings ?? []).some((f) => f.ruleId === 'qa-flow-assertion')).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'selector tidak valid menjadi kegagalan langkah, bukan crash modul',
    async () => {
      const out = await run({
        startPath: '/',
        maxDepth: 0,
        linkCheckLimit: 0,
        flows: [
          {
            name: 'selector',
            steps: [{ action: 'expectCount', selector: '::bukan-selector((', count: 1 }],
          },
        ],
      });
      expect(out.status).toBe('FAIL');
      expect((out.findings ?? []).some((f) => f.ruleId === 'qa-flow-assertion')).toBe(true);
    },
    TIMEOUT_MS,
  );

  it(
    'kegagalan penyimpanan artefak tidak menggagalkan modul; temuan tanpa bukan CONFIRMED',
    async () => {
      const broken = {
        write: () => {
          throw new Error('disk penuh (uji)');
        },
      } as unknown as ArtifactStore;
      const out = await run(
        { startPath: '/', maxDepth: 0, linkCheckLimit: 0 },
        { artifactsOverride: broken },
      );
      expect(out.status).toBe('FAIL');
      const findings = out.findings ?? [];
      expect(findings.length).toBeGreaterThan(0);
      for (const f of findings) {
        expect(f.evidenceRefs).toEqual([]);
        expect(f.verification).toBe('LIKELY');
      }
      expect(out.artifactRefs ?? []).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    'tombol submit form tidak dikirim: klik ditolak dan tidak ada POST ke aplikasi',
    async () => {
      const out = await run({
        startPath: '/',
        maxDepth: 0,
        linkCheckLimit: 0,
        flows: [{ name: 'kirim', steps: [{ action: 'click', selector: '#lanjut' }] }],
      });
      expect(out.status).toBe('ERROR');
      expect(out.errorCode).toBe('VALIDATION_FAILED');
      expect(site?.postHits()).toBe(0);
    },
    TIMEOUT_MS,
  );

  it(
    'antrean crawl dibatasi oleh percobaan navigasi, bukan hanya halaman sukses',
    async () => {
      const out = await run({ startPath: '/many', maxPages: 3, maxDepth: 1, linkCheckLimit: 0 });
      // Batas 3 percobaan (1 halaman awal + 2 tautan). Chrome dapat mengulang request yang
      // gagal, jadi yang diukur adalah jumlah URL unik yang dicoba, bukan jumlah hit server.
      const distinctSocketUrls = [...(site?.hits.keys() ?? [])].filter((u) =>
        u.startsWith('/socket-drop'),
      );
      expect(distinctSocketUrls.length).toBeGreaterThanOrEqual(1);
      expect(distinctSocketUrls.length).toBeLessThanOrEqual(2);
      expect(out.metrics?.['pagesVisited']).toBe(1);
    },
    TIMEOUT_MS,
  );

  it(
    'browser mati di tengah run (simulasi crash) menghasilkan ERROR, bukan hang atau PASS',
    async () => {
      site = await startSite();
      const grant: ScopeGrant = { origin: site.origin, mode: 'local-fixture' };
      const target = createTarget({
        label: 'uji crash',
        origin: site.origin,
        mode: 'fixture',
        allowedModules: [],
        scopeConfirmedAt: null,
      });
      store.targets.insert(target);
      const orch = new RunOrchestrator({
        store,
        adapters: [new FunctionalQaAdapter({ artifacts })],
      });
      const runRecord = orch.createRun({
        target,
        grant,
        modules: ['FUNCTIONAL_QA'],
        acknowledged: true,
      });
      const ctx: ModuleContext = {
        runId: runRecord.id,
        moduleResultId: `mod_${'b'.repeat(32)}`,
        targetOrigin: site.origin,
        grant,
        signal: new AbortController().signal,
        progress: () => undefined,
      };
      const adapter = new FunctionalQaAdapter({
        artifacts,
        config: { startPath: '/hang', navigationTimeoutMs: 20000, maxDepth: 0 },
        executablePath: BROWSER_PATH,
        launch: async (o) => {
          const b = await chromium.launch(o);
          launched.push(b);
          // Simulasi crash: proses browser dihentikan saat navigasi sedang menunggu respons.
          setTimeout(() => void b.close(), 1000);
          return b;
        },
      });
      const started = Date.now();
      const out = await adapter.run(ctx);
      expect(out.status).toBe('ERROR');
      expect(out.errorCode).not.toBe('CANCELLED');
      expect(Date.now() - started).toBeLessThan(15_000);
      expect(launched.every((b) => !b.isConnected())).toBe(true);
    },
    TIMEOUT_MS,
  );
});

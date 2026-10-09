import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, describe, expect, it } from 'vitest';
import { runLighthouseWithEgress } from '../src/lighthouse.js';

/**
 * F-06 — integrasi runtime dengan Chromium nyata dan Lighthouse.
 *
 * Dua server fixture di loopback:
 *  - TARGET: origin yang disetujui. Halamannya memuat subresource ke OTHER, redirect ke OTHER, dan
 *    subresource miliknya sendiri.
 *  - OTHER: layanan lokal lain yang TIDAK diizinkan. Hitungannya harus 0.
 *
 * Bukti penolakan: OTHER dipastikan hidup (diakses langsung dari Node dulu), jadi 0 hit berarti
 * request ditolak di lapisan proxy, bukan karena server tidak berjalan. Daftar `denied` dari proxy
 * juga harus memuat OTHER.
 *
 * Diuji untuk tiga bentuk host: IPv4 literal, `localhost`, dan IPv6 `[::1]`.
 * Tes wajib dijalankan dengan CHROMIUM_PATH. REQUIRE_BROWSER_TESTS=1 menggagalkan bila tidak ada.
 */
const BROWSER = process.env['CHROMIUM_PATH'];
const REQUIRE = process.env['REQUIRE_BROWSER_TESTS'] === '1';
if (REQUIRE && !BROWSER) {
  throw new Error(
    'REQUIRE_BROWSER_TESTS=1 tetapi CHROMIUM_PATH kosong: tes browser tidak boleh dilewati.',
  );
}

type Forms = { readonly label: string; readonly host: string };
const FORMS: readonly Forms[] = [
  { label: 'IPv4 literal', host: '127.0.0.1' },
  { label: 'hostname localhost', host: 'localhost' },
  { label: 'IPv6 literal', host: '[::1]' },
];

type Server = { server: http.Server; port: number; hits: string[] };

function listen(host: string, handler: http.RequestListener): Promise<Server> {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    handler(req, res);
  });
  const bind = host.startsWith('[') ? '::1' : host;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, bind, () => {
      server.off('error', reject);
      resolve({ server, port: (server.address() as AddressInfo).port, hits });
    });
  });
}

function hostFor(form: Forms, port: number): string {
  return `http://${form.host}:${port}`;
}

/** Ambil URL langsung dari Node untuk membuktikan server OTHER hidup. */
function directGet(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    http
      .get(url, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      })
      .on('error', reject);
  });
}

const describeBrowser = BROWSER ? describe : describe.skip;

/** Path Chromium wajib ada saat tes browser berjalan. Melempar error bila tidak (tidak diam-diam null). */
function requireBrowser(): string {
  if (!BROWSER) throw new Error('CHROMIUM_PATH belum diset');
  return BROWSER;
}

describeBrowser('Lighthouse egress runtime (F-06)', () => {
  const servers: Server[] = [];

  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.server.close(r))));
  });

  for (const form of FORMS) {
    it(`${form.label}: target sah bisa diakses, server lain tidak menerima satu request pun`, async () => {
      const other = await listen(form.host, (_req, res) => {
        res.setHeader('content-type', 'text/plain');
        res.end('other-secret');
      });
      servers.push(other);
      const otherUrl = hostFor(form, other.port) + '/secret.txt';
      const otherSelf = await directGet(otherUrl);
      expect(otherSelf).toBe(200);
      const otherHitsBefore = other.hits.length;

      const target = await listen(form.host, (req, res) => {
        const path = req.url ?? '/';
        if (path === '/') {
          res.setHeader('content-type', 'text/html');
          res.end(
            `<!doctype html><html><head><title>fixture</title>
<link rel="stylesheet" href="${hostFor(form, other.port)}/style.css">
<script src="${hostFor(form, other.port)}/app.js"></script>
</head><body><h1>Fixture</h1>
<img src="${hostFor(form, other.port)}/pixel.png" alt="p">
<img src="/own.png" alt="own">
<script>fetch('${hostFor(form, other.port)}/beacon').catch(() => {});</script>
</body></html>`,
          );
        } else if (path === '/redirect') {
          res.writeHead(302, { location: `${hostFor(form, other.port)}/after-redirect` });
          res.end();
        } else if (path === '/own.png' || path === '/style-own.css') {
          res.setHeader('content-type', path.endsWith('.png') ? 'image/png' : 'text/css');
          res.end(path.endsWith('.png') ? Buffer.alloc(0) : '');
        } else {
          res.writeHead(404).end();
        }
      });
      servers.push(target);
      const targetUrl = hostFor(form, target.port) + '/';

      const run = await runLighthouseWithEgress({
        url: targetUrl,
        chromePath: requireBrowser(),
        settings: {},
        onlyCategories: ['performance'],
        signal: new AbortController().signal,
      });

      // 1. Target yang sah diakses.
      expect(target.hits).toContain('/');
      // 2. Server lain tidak menerima request apa pun dari Chrome (termasuk subresource, fetch, dan redirect).
      expect(other.hits.length).toBe(otherHitsBefore);
      // 3. Penolakan tercatat di proxy, bukan karena server tidak tersedia.
      expect(run.denied).toContain(`${form.host}:${other.port}`);
      // 4. Lighthouse menghasilkan LHR (run selesai, bukan error).
      expect(run.lhr).toBeTruthy();
    }, 240_000);
  }

  it('redirect dari target ke server lain tidak diikuti (IPv4 literal)', async () => {
    const form = FORMS[0];
    if (!form) throw new Error('FORMS kosong');
    const other = await listen(form.host, (_req, res) => res.end('after'));
    servers.push(other);
    const target = await listen(form.host, (req, res) => {
      if ((req.url ?? '') === '/') {
        res.setHeader('content-type', 'text/html');
        res.end('<!doctype html><html><body><a href="/go">go</a></body></html>');
      } else if ((req.url ?? '') === '/go') {
        res.writeHead(302, { location: `${hostFor(form, other.port)}/after` });
        res.end();
      } else res.writeHead(404).end();
    });
    servers.push(target);
    const run = await runLighthouseWithEgress({
      url: hostFor(form, target.port) + '/go',
      chromePath: requireBrowser(),
      settings: {},
      onlyCategories: ['performance'],
      signal: new AbortController().signal,
    });
    expect(other.hits.length).toBe(0);
    expect(run.denied.length).toBeGreaterThan(0);
  }, 240_000);
});

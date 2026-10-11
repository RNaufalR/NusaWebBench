import http from 'node:http';
import net from 'node:net';
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

type Server = {
  server: http.Server;
  port: number;
  hits: string[];
  close: () => Promise<void>;
};

/**
 * Error socket yang tidak terduga selama suite berjalan. ECONNRESET/EPIPE karena peer menutup
 * koneksi (Chrome yang di-kill setelah run, proxy.close() yang menghancurkan upstream) adalah
 * lifecycle TCP yang dapat diprediksi untuk server fixture — bukan kegagalan. Error lain
 * (mis. kegagalan bind, kesalahan internal) dicatat dan menggagalkan suite di afterAll.
 */
const unexpectedSocketErrors: Error[] = [];

function listen(host: string, handler: http.RequestListener): Promise<Server> {
  const hits: string[] = [];
  const sockets = new Set<net.Socket>();
  const server = http.createServer((req, res) => {
    hits.push(req.url ?? '');
    handler(req, res);
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ECONNRESET' && code !== 'EPIPE') unexpectedSocketErrors.push(err);
      s.destroy();
    });
    s.on('close', () => sockets.delete(s));
  });
  server.on('clientError', (_err, socket) => socket.destroy());
  const bind = host.startsWith('[') ? '::1' : host;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, bind, () => {
      server.off('error', reject);
      resolve({
        server,
        port: (server.address() as AddressInfo).port,
        hits,
        // Hancurkan koneksi terbuka dulu: server.close() saja tidak menutup koneksi
        // keep-alive yang masih menggantung, meninggalkan orphan socket.
        close: () =>
          new Promise<void>((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
            server.closeAllConnections?.();
          }),
      });
    });
  });
}

function hostFor(form: Forms, port: number): string {
  return `http://${form.host}:${port}`;
}

/** Ambil URL langsung dari Node untuk membuktikan server OTHER hidup. */
function directGet(url: string): Promise<number> {
  // Agent khusus tanpa keep-alive: socket tidak di-pool sehingga tidak ada koneksi
  // menggantung yang hidup melewati masa pakai tes.
  const agent = new http.Agent({ keepAlive: false });
  return new Promise((resolve, reject) => {
    const req = http.get(url, { agent }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode ?? 0));
    });
    req.on('error', (err) => {
      agent.destroy();
      reject(err);
    });
    req.on('close', () => agent.destroy());
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
    await Promise.all(servers.map((s) => s.close()));
    // Error socket di luar lifecycle normal (bukan ECONNRESET/EPIPE) menggagalkan suite.
    expect(unexpectedSocketErrors).toEqual([]);
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

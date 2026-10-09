import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  checkUrlInScope,
  createScopeGrant,
  followRedirectsPinned,
  MAX_REDIRECT_HOPS,
  type Resolver,
} from '../src/index.js';

/**
 * F-05 — ketahanan HTTP: rebinding per hop, timeout total, pembatalan, batas redirect, dan
 * variasi parsing URL. Semua koneksi ke server loopback fixture milik tes. Tidak ada DNS eksternal.
 */

let server: Server;
let port = 0;
const hits = new Map<string, number>();
const openSockets = new Set<import('node:net').Socket>();

function hit(path: string): void {
  hits.set(path, (hits.get(path) ?? 0) + 1);
}

beforeAll(async () => {
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const path = req.url ?? '/';
    hit(path);
    if (path === '/b') {
      res.writeHead(200, { 'content-type': 'text/plain' }).end('b');
    } else if (path === '/a') {
      res.writeHead(302, { location: '/b' }).end();
    } else if (path === '/loop') {
      res.writeHead(302, { location: '/loop' }).end();
    } else if (path === '/slow') {
      // Tidak pernah merespons. Hanya dihentikan oleh timeout total atau pembatalan.
      req.on('close', () => undefined);
    } else {
      res.writeHead(404).end();
    }
  });
  server.on('connection', (s) => {
    openSockets.add(s);
    s.on('close', () => openSockets.delete(s));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const s of openSockets) s.destroy();
  await new Promise<void>((r) => server.close(() => r()));
});

describe('rebinding per hop (F-05)', () => {
  it('setiap hop divalidasi ulang: hop kedua yang resolve ke alamat privat ditolak sebelum koneksi', async () => {
    const grant = createScopeGrant(`http://localhost:${port}`, 'local-fixture');
    let call = 0;
    // Hop 1 (localhost) -> 127.0.0.1 (diizinkan). Hop 2 (localhost) -> 10.0.0.5 (ditolak scope).
    const resolver: Resolver = async () => (++call === 1 ? ['127.0.0.1'] : ['10.0.0.5']);
    const before = hits.get('/b') ?? 0;
    const res = await followRedirectsPinned(`http://localhost:${port}/a`, grant, 2000, resolver);
    expect(res).toEqual({ ok: false, reason: 'address-not-allowed' });
    expect(hits.get('/b') ?? 0).toBe(before);
  });
});

describe('batas dan pembatalan (F-05)', () => {
  it('timeout total menghentikan rantai yang tidak pernah merespons', async () => {
    const grant = createScopeGrant(`http://localhost:${port}`, 'local-fixture');
    const started = Date.now();
    const res = await followRedirectsPinned(
      `http://localhost:${port}/slow`,
      grant,
      300,
      async () => ['127.0.0.1'],
    );
    expect(res).toEqual({ ok: false, reason: 'fetch-failed' });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('pembatalan dari pemanggil menghentikan request yang sedang berjalan', async () => {
    const grant = createScopeGrant(`http://localhost:${port}`, 'local-fixture');
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 150);
    const started = Date.now();
    const res = await followRedirectsPinned(
      `http://localhost:${port}/slow`,
      grant,
      10_000,
      async () => ['127.0.0.1'],
      ac.signal,
    );
    expect(res).toEqual({ ok: false, reason: 'fetch-failed' });
    expect(Date.now() - started).toBeLessThan(3000);
  });

  it('signal yang sudah dibatalkan sebelum mulai tidak membuat koneksi', async () => {
    const grant = createScopeGrant(`http://localhost:${port}`, 'local-fixture');
    const ac = new AbortController();
    ac.abort();
    const before = hits.get('/b') ?? 0;
    const res = await followRedirectsPinned(
      `http://localhost:${port}/b`,
      grant,
      2000,
      async () => ['127.0.0.1'],
      ac.signal,
    );
    expect(res.ok).toBe(false);
    expect(hits.get('/b') ?? 0).toBe(before);
  });

  it(`redirect berulang dihentikan setelah ${MAX_REDIRECT_HOPS} hop`, async () => {
    const grant = createScopeGrant(`http://localhost:${port}`, 'local-fixture');
    const before = hits.get('/loop') ?? 0;
    const res = await followRedirectsPinned(
      `http://localhost:${port}/loop`,
      grant,
      5000,
      async () => ['127.0.0.1'],
    );
    expect(res).toEqual({ ok: false, reason: 'redirect-limit-exceeded' });
    expect((hits.get('/loop') ?? 0) - before).toBe(MAX_REDIRECT_HOPS + 1);
  });
});

describe('variasi parsing URL ditolak atau dinormalisasi (F-05)', () => {
  const grant = createScopeGrant('https://fixture.example', 'remote');
  const publicResolver: Resolver = async () => ['93.184.216.34'];

  it.each([
    ['userinfo', 'https://user:pass@fixture.example/', 'credentials-not-allowed'],
    ['skema file', 'file:///etc/passwd', 'protocol-not-allowed'],
    ['skema ftp', 'ftp://fixture.example/', 'protocol-not-allowed'],
    ['karakter kontrol', 'https://fixture.example/\n/x', 'url-control-characters'],
    ['hostname dengan titik akhir', 'https://localhost./', 'hostname-invalid'],
  ])('%s ditolak (%s)', async (_label, url, reason) => {
    const decision = await checkUrlInScope(url, grant, publicResolver);
    expect(decision).toEqual({ allowed: false, reason });
  });

  it.each([
    ['IPv4 metadata desimal', 'http://2852039166/'],
    ['IPv4 metadata hex', 'http://0xa9fea9fe/'],
    ['IPv4 metadata oktal', 'http://0251.0376.0251.0376/'],
    ['IPv4-mapped IPv6 metadata', 'http://[::ffff:169.254.169.254]/'],
    ['IPv6 ULA', 'http://[fd00::1]/'],
  ])('%s tidak pernah diizinkan (%s)', async (_label, url) => {
    // Grant remote untuk fixture.example: literal IP di luar origin ditolak; bila lolos origin,
    // alamat privat tetap ditolak. Keduanya adalah deny.
    const decision = await checkUrlInScope(url, grant, publicResolver);
    expect(decision.allowed).toBe(false);
  });

  it('host dengan port non-standar di luar allowlist ditolak', async () => {
    const decision = await checkUrlInScope('https://fixture.example:8443/', grant, publicResolver);
    expect(decision).toEqual({ allowed: false, reason: 'port-not-allowed' });
  });
});

describe('timeout total vs timeout idle (F-05)', () => {
  it('server yang terus mengirim byte header (tidak idle) tetap dihentikan oleh timeout total', async () => {
    // Timeout idle socket tidak pernah aktif karena selalu ada byte baru. Hanya batas total yang
    // dapat menghentikan rantai ini. Tanpa batas total, tes ini menggantung sampai batas Vitest.
    const { createServer: createNetServer } = await import('node:net');
    const trickle = createNetServer((sock) => {
      sock.write('HTTP/1.1 200 OK\r\nx-start: 1\r\n');
      const timer = setInterval(() => {
        if (sock.destroyed) return clearInterval(timer);
        sock.write('x-trickle: 1\r\n');
      }, 50);
      sock.on('close', () => clearInterval(timer));
      sock.on('error', () => clearInterval(timer));
    });
    await new Promise<void>((r) => trickle.listen(0, '127.0.0.1', () => r()));
    const tport = (trickle.address() as AddressInfo).port;
    try {
      const grant = createScopeGrant(`http://localhost:${tport}`, 'local-fixture');
      const started = Date.now();
      const res = await followRedirectsPinned(
        `http://localhost:${tport}/x`,
        grant,
        400,
        async () => ['127.0.0.1'],
      );
      expect(res).toEqual({ ok: false, reason: 'fetch-failed' });
      expect(Date.now() - started).toBeLessThan(3000);
    } finally {
      await new Promise<void>((r) => trickle.close(() => r()));
    }
  }, 10_000);
});

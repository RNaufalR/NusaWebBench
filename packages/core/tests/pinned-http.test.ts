import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AppError,
  browserPinArgs,
  createScopeGrant,
  followRedirectsPinned,
  pinnedGet,
  pinnedLookup,
} from '../src/index.js';

/** Server loopback lokal (fixture). Tidak ada koneksi ke alamat pihak ketiga dalam tes ini. */
let server: Server;
let port = 0;
const hits: string[] = [];

beforeAll(async () => {
  server = createServer((req, res) => {
    hits.push(req.url ?? '');
    if (req.url === '/a') {
      res.writeHead(302, { location: '/b' });
      res.end();
      return;
    }
    if (req.url === '/to-loopback-literal') {
      res.writeHead(302, { location: 'http://[::ffff:7f00:1]/' });
      res.end();
      return;
    }
    if (req.url === '/b') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('ok');
      return;
    }
    res.writeHead(404);
    res.end('missing');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('followRedirectsPinned (F-05)', () => {
  it('mengikuti redirect dengan koneksi terpin dan mengembalikan status akhir', async () => {
    const grant = createScopeGrant(`http://localhost:${port}`, 'local-fixture');
    const seen: string[] = [];
    const resolver = async (host: string) => {
      seen.push(host);
      return ['127.0.0.1'];
    };
    const res = await followRedirectsPinned(`http://localhost:${port}/a`, grant, 2000, resolver);
    expect(res).toMatchObject({ ok: true, hops: 1, status: 200 });
    expect(res.ok && res.finalUrl).toBe(`http://localhost:${port}/b`);
    // Setiap hop diperiksa sekali; tidak ada resolusi tambahan di luar pemeriksaan scope.
    expect(seen.length).toBe(2);
  });

  it('link rusak (404) tetap dikembalikan sebagai status, bukan error koneksi', async () => {
    const grant = createScopeGrant(`http://localhost:${port}`, 'local-fixture');
    const res = await followRedirectsPinned(
      `http://localhost:${port}/tidak-ada`,
      grant,
      2000,
      async () => ['127.0.0.1'],
    );
    expect(res).toMatchObject({ ok: true, status: 404 });
  });

  it('menolak redirect ke literal IP loopback (remote) sebelum koneksi apa pun', async () => {
    const grant = createScopeGrant(`http://localhost:${port}`, 'local-fixture');
    const before = hits.length;
    const res = await followRedirectsPinned(
      `http://localhost:${port}/to-loopback-literal`,
      grant,
      2000,
      async () => ['127.0.0.1'],
    );
    // Hop pertama mengembalikan redirect ke origin lain: ditolak oleh cek scope pada hop berikutnya.
    expect(res.ok).toBe(false);
    expect(hits.length).toBe(before + 1);
  });

  it('remote: resolver yang mengembalikan loopback ditolak sebelum koneksi', async () => {
    const grant = createScopeGrant('https://fixture.example', 'remote');
    const res = await followRedirectsPinned('https://fixture.example/', grant, 2000, async () => [
      '127.0.0.1',
    ]);
    expect(res).toEqual({ ok: false, reason: 'address-not-allowed' });
  });
});

describe('pinnedGet: koneksi memakai alamat terpin, bukan DNS (regresi rebinding)', () => {
  it('menghubungi alamat terpin meskipun hostname tidak pernah bisa di-resolve', async () => {
    // `.invalid` dijamin tidak pernah resolve (RFC 2606). Jika DNS dipakai, permintaan gagal.
    const res = await pinnedGet(`http://pinned-check.invalid:${port}/b`, '127.0.0.1', 2000);
    expect(res.status).toBe(200);
  });
});

describe('pinnedLookup', () => {
  it('mengembalikan alamat terpin tanpa DNS, dalam bentuk alamat tunggal dan array (all)', () => {
    const lookup = pinnedLookup('93.184.216.34');
    let single: unknown[] = [];
    lookup('fixture.example', {}, (_err, addr, fam) => {
      single = [addr, fam];
    });
    expect(single).toEqual(['93.184.216.34', 4]);
    let many: unknown = null;
    lookup('fixture.example', { all: true }, (_err, addrs) => {
      many = addrs;
    });
    expect(many).toEqual([{ address: '93.184.216.34', family: 4 }]);
  });
});

describe('browserPinArgs (F-05 browser)', () => {
  it('remote: pin host target ke alamat hasil cek, host lain NOTFOUND', async () => {
    const grant = createScopeGrant('https://fixture.example', 'remote');
    const args = await browserPinArgs(grant, async () => ['93.184.216.34']);
    expect(args).toEqual([
      '--host-resolver-rules=MAP fixture.example 93.184.216.34,MAP * ~NOTFOUND',
    ]);
  });

  it('remote IPv6: alamat dibungkus kurung siku', async () => {
    const grant = createScopeGrant('https://fixture.example', 'remote');
    const args = await browserPinArgs(grant, async () => ['2606:2800:220:1:248:1893:25c8:1946']);
    expect(args[0]).toContain('MAP fixture.example [2606:2800:220:1:248:1893:25c8:1946]');
  });

  it('local-fixture tidak menambah argumen', async () => {
    const grant = createScopeGrant(`http://localhost:${port}`, 'local-fixture');
    expect(await browserPinArgs(grant, async () => ['127.0.0.1'])).toEqual([]);
  });

  it('remote: hasil resolver privat ditolak dengan SCOPE_DENIED', async () => {
    const grant = createScopeGrant('https://fixture.example', 'remote');
    await expect(browserPinArgs(grant, async () => ['10.0.0.5'])).rejects.toBeInstanceOf(AppError);
  });
});

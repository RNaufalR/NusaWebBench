import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { originKey, startEgressProxy, type EgressProxy } from '../src/egress-proxy.js';

/** F-06 (tanpa browser): aturan allowlist proxy. Perilaku dengan Chromium nyata ada di egress-integration.test.ts. */
describe('egress proxy allowlist (F-06)', () => {
  let target: http.Server;
  let other: http.Server;
  let targetPort = 0;
  let otherPort = 0;
  const hits: { target: number; other: number } = { target: 0, other: 0 };
  let proxy: EgressProxy;

  beforeAll(async () => {
    target = http.createServer((_q, s) => {
      hits.target++;
      s.end('target-ok');
    });
    other = http.createServer((_q, s) => {
      hits.other++;
      s.end('other-secret');
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', r));
    await new Promise<void>((r) => other.listen(0, '127.0.0.1', r));
    targetPort = (target.address() as AddressInfo).port;
    otherPort = (other.address() as AddressInfo).port;
    proxy = await startEgressProxy([`http://127.0.0.1:${targetPort}/`]);
  });

  afterAll(async () => {
    await proxy.close();
    await new Promise((r) => target.close(r));
    await new Promise((r) => other.close(r));
  });

  /** Request absolute-form lewat proxy, seperti yang dilakukan Chrome. */
  function viaProxy(absUrl: string): Promise<number> {
    const p = new URL(proxy.proxyUrl);
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: p.hostname,
          port: Number(p.port),
          method: 'GET',
          path: absUrl,
          headers: { host: new URL(absUrl).host },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode ?? 0));
        },
      );
      req.on('error', reject);
      req.end();
    });
  }

  it('meneruskan origin yang diizinkan', async () => {
    const before = hits.target;
    expect(await viaProxy(`http://127.0.0.1:${targetPort}/ok`)).toBe(200);
    expect(hits.target).toBe(before + 1);
  });

  it('menolak origin lain di loopback dan tidak menyentuh server tersebut', async () => {
    const before = hits.other;
    expect(await viaProxy(`http://127.0.0.1:${otherPort}/secret`)).toBe(403);
    expect(hits.other).toBe(before);
    expect(proxy.denied()).toContain(`127.0.0.1:${otherPort}`);
  });

  it('localhost dengan port yang sama dianggap origin berbeda (tanpa wildcard)', async () => {
    expect(await viaProxy(`http://localhost:${targetPort}/x`)).toBe(403);
  });

  it('bentuk IPv4 tidak kanonik dinormalisasi lalu tetap dibandingkan persis', async () => {
    // 0177.0.0.1 dinormalisasi URL menjadi 127.0.0.1 -> origin yang diizinkan.
    expect(originKey(new URL('http://0177.0.0.1:8080/'))).toBe('127.0.0.1:8080');
    expect(await viaProxy(`http://0177.0.0.1:${targetPort}/ok`)).toBe(200);
  });

  it('CONNECT ke origin lain ditolak dengan 403', async () => {
    const p = new URL(proxy.proxyUrl);
    const status = await new Promise<number>((resolve, reject) => {
      const sock = net.connect(Number(p.port), '127.0.0.1', () => {
        sock.write(
          `CONNECT 127.0.0.1:${otherPort} HTTP/1.1\r\nhost: 127.0.0.1:${otherPort}\r\n\r\n`,
        );
      });
      sock.once('data', (d) => {
        resolve(Number(d.toString().split(' ')[1]));
        sock.destroy();
      });
      sock.on('error', reject);
    });
    expect(status).toBe(403);
    expect(proxy.denied()).toContain(`127.0.0.1:${otherPort}`);
  });

  it('request langsung (bukan absolute-form) ditolak', async () => {
    const p = new URL(proxy.proxyUrl);
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.get({ host: p.hostname, port: Number(p.port), path: '/' }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
    });
    expect(status).toBe(400);
  });

  it('skema selain http ditolak (https hanya lewat CONNECT)', async () => {
    expect(await viaProxy(`https://127.0.0.1:${targetPort}/`).catch(() => 403)).not.toBe(200);
  });

  it('menolak konfigurasi yang bukan http/https', async () => {
    await expect(startEgressProxy(['file:///etc/passwd'])).rejects.toThrow(/EGRESS_PROXY_CONFIG/);
  });
});

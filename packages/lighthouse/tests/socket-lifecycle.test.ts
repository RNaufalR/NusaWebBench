import http from 'node:http';
import net from 'node:net';
import { describe, expect, it } from 'vitest';
import { startEgressProxy, type EgressProxy } from '../src/egress-proxy.js';

/**
 * Regresi untuk CI run 38111943491: job "Tes browser" gagal (exit code 1) padahal 676 tes
 * lulus dan 0 gagal — satu unhandled error "read ECONNRESET" dari socket TCP.
 *
 * Investigasi (repro dengan RST brutal, 20 koneksi simultan, teardown balapan) membuktikan
 * socket yang diterima http.Server maupun ClientRequest di kode ini tidak melempar
 * uncaughtException; RST adalah lifecycle TCP normal ketika peer (mis. Chrome yang di-kill
 * tepat setelah run) menutup koneksi. Tes ini mengunci perilaku tersebut: RST dan request
 * terpotong tidak boleh menjadi uncaughtException, dan proxy harus tetap melayani request
 * berikutnya.
 *
 * Tidak membutuhkan Chromium: memakai socket TCP mentah.
 */
describe('socket lifecycle egress proxy (regresi ECONNRESET CI)', () => {
  /**
   * Menangkap uncaughtException selama `ms` agar dapat di-assert tanpa menjatuhkan run.
   * Timeout di sini beralasan: memberi kesempatan error async muncul bila bug ada.
   */
  function captureUncaught(ms: number): Promise<unknown[]> {
    const errors: unknown[] = [];
    const onErr = (e: unknown): void => {
      errors.push(e);
    };
    process.on('uncaughtException', onErr);
    return new Promise((resolve) => {
      setTimeout(() => {
        process.off('uncaughtException', onErr);
        resolve(errors);
      }, ms);
    });
  }

  /** Request absolute-form via proxy; mengembalikan status code. */
  function viaProxy(proxy: EgressProxy, absUrl: string): Promise<number> {
    const p = new URL(proxy.proxyUrl);
    return new Promise<number>((resolve, reject) => {
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

  /** Membuka koneksi ke proxy, menjalankan `act`, lalu menghancurkannya secara abrupt (RST). */
  function rstClient(proxy: EgressProxy, act: (sock: net.Socket) => void): Promise<void> {
    const p = new URL(proxy.proxyUrl);
    return new Promise<void>((resolve) => {
      const sock = net.connect(Number(p.port), p.hostname, () => {
        act(sock);
        sock.destroy();
      });
      sock.on('error', () => undefined);
      sock.on('close', () => resolve());
    });
  }

  it('RST tiba-tiba dari client bukan uncaughtException; proxy tetap melayani', async () => {
    const proxy = await startEgressProxy(['http://127.0.0.1:9/']);
    try {
      const captured = captureUncaught(500);
      // Mensimulasikan Chrome yang di-kill di tengah koneksi keep-alive: request parsial
      // lalu RST tanpa membaca respons.
      await rstClient(proxy, (sock) => {
        sock.write('GET http://127.0.0.1:9/ HTTP/1.1\r\nHost: 127.0.0.1:9\r\n');
      });
      expect(await captured).toEqual([]);
      // Proxy harus tetap berfungsi setelah RST.
      expect(await viaProxy(proxy, 'http://127.0.0.1:1/rahasia')).toBe(403);
      expect(proxy.denied()).toContain('127.0.0.1:1');
    } finally {
      await proxy.close();
    }
  });

  it('request terpotong di tengah header (clientError) bukan uncaughtException', async () => {
    const proxy = await startEgressProxy(['http://127.0.0.1:9/']);
    try {
      const captured = captureUncaught(500);
      await rstClient(proxy, (sock) => {
        sock.write('GET / HTTP/1.1\r\nHost:');
      });
      expect(await captured).toEqual([]);
      expect(await viaProxy(proxy, 'http://127.0.0.1:1/x')).toBe(403);
    } finally {
      await proxy.close();
    }
  });

  it('RST saat teardown (close berbalapan dengan request) bukan uncaughtException', async () => {
    const proxy = await startEgressProxy(['http://127.0.0.1:9/']);
    const captured = captureUncaught(800);
    const p = new URL(proxy.proxyUrl);
    // Membanjiri proxy dengan koneksi lalu menutup proxy saat request masih in-flight.
    const clients: Array<Promise<void>> = [];
    for (let i = 0; i < 15; i++) {
      clients.push(
        new Promise<void>((resolve) => {
          const sock = net.connect(Number(p.port), p.hostname, () => {
            sock.write(
              `GET http://127.0.0.1:9/${i} HTTP/1.1\r\nHost: 127.0.0.1:9\r\nConnection: keep-alive\r\n\r\n`,
            );
          });
          sock.on('error', () => undefined);
          sock.on('close', () => resolve());
          setTimeout(() => sock.destroy(), 50);
        }),
      );
    }
    await new Promise((r) => setTimeout(r, 20));
    await proxy.close();
    await Promise.all(clients);
    expect(await captured).toEqual([]);
  });
});

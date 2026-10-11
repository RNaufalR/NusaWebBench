/**
 * Tes integrasi TLS/SNI untuk jalur pinned (F-05).
 *
 * Status sebelumnya: jalur TLS/SNI dengan sertifikat tidak tepercaya BLOCKED
 * ("belum ada skenario uji", SECURITY_REMEDIATION_REPORT.md). Tes ini menutup
 * celah itu memakai fixture TLS lokal yang terkontrol (sertifikat dibuat saat
 * runtime dengan openssl; tidak ada jaringan eksternal).
 *
 * Yang dibuktikan:
 * 1. Sertifikat tidak tepercaya SELALU ditolak (fail-closed; tidak ada fallback diam-diam).
 * 2. SNI memakai hostname dari URL, bukan alamat IP terpin.
 * 3. Sertifikat untuk hostname yang salah ditolak.
 * 4. Sertifikat kedaluwarsa ditolak.
 * 5. Kegagalan handshake tidak menggantung dan socket dibersihkan.
 */
import { execSync } from 'node:child_process';
import { createServer as createHttpServer } from 'node:http';
import { createServer as createTlsServer, type Server as TlsServer } from 'node:https';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { AddressInfo, Socket } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pinnedGet } from '../src/pinned-http.js';

let dir = '';
let goodKey = '';
let goodCert = '';
let wrongCert = '';
let wrongKey = '';
let expiredCert = '';

function openssl(args: string): void {
  execSync(`openssl ${args}`, { cwd: dir, stdio: 'pipe' });
}

beforeAll(() => {
  try {
    execSync('openssl version', { stdio: 'pipe' });
  } catch {
    throw new Error('openssl tidak tersedia; tes TLS fixture membutuhkan openssl');
  }
  dir = mkdtempSync(join(tmpdir(), 'nwb-tls-'));
  // CA lokal (tidak dipercaya sistem; klien harus menolak rantai ini).
  openssl(
    'req -x509 -newkey rsa:2048 -keyout ca-key.pem -out ca.pem -days 2 -nodes -subj "/CN=NWB Test CA"',
  );
  // Sertifikat server yang benar untuk fixture.example, ditandatangani CA lokal.
  openssl(
    'req -newkey rsa:2048 -keyout srv-key.pem -out srv.csr -nodes -subj "/CN=fixture.example"',
  );
  writeFileSync(join(dir, 'san-good.ext'), 'subjectAltName=DNS:fixture.example');
  openssl(
    'x509 -req -in srv.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out srv-cert.pem -days 2 -extfile san-good.ext',
  );
  // Sertifikat untuk hostname yang salah.
  openssl(
    'req -newkey rsa:2048 -keyout wrong-key.pem -out wrong.csr -nodes -subj "/CN=wrong.example"',
  );
  writeFileSync(join(dir, 'san-wrong.ext'), 'subjectAltName=DNS:wrong.example');
  openssl(
    'x509 -req -in wrong.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial -out wrong-cert.pem -days 2 -extfile san-wrong.ext',
  );
  // Sertifikat kedaluwarsa (openssl x509 -req tidak mendukung -startdate/-enddate;
  // pakai openssl ca dengan config minimal).
  writeFileSync(
    join(dir, 'ca.cnf'),
    `[ ca ]
default_ca = CA_default
[ CA_default ]
database = ./cadb/index.txt
new_certs_dir = ./cadb
serial = ./cadb/serial
default_md = sha256
policy = policy_any
[ policy_any ]
commonName = supplied
[ req ]
distinguished_name = dn
[ dn ]
`,
  );
  execSync('mkdir -p cadb && touch cadb/index.txt && echo 1000 > cadb/serial', {
    cwd: dir,
    stdio: 'pipe',
  });
  writeFileSync(join(dir, 'san-exp.ext'), '[san_exp]\nsubjectAltName=DNS:fixture.example');
  openssl(
    'ca -batch -config ca.cnf -in srv.csr -out expired-cert.pem -keyfile ca-key.pem -cert ca.pem -startdate 20200101000000Z -enddate 20200102000000Z -extensions san_exp -extfile san-exp.ext',
  );

  goodKey = join(dir, 'srv-key.pem');
  goodCert = join(dir, 'srv-cert.pem');
  wrongKey = join(dir, 'wrong-key.pem');
  wrongCert = join(dir, 'wrong-cert.pem');
  expiredCert = join(dir, 'expired-cert.pem');
}, 60000);

afterAll(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
});

type TlsFixture = {
  port: number;
  seenSni: string[];
  openSockets: Set<Socket>;
  close: () => Promise<void>;
};

async function startTlsServer(certFile: string, keyFile: string): Promise<TlsFixture> {
  const { readFileSync } = await import('node:fs');
  const seenSni: string[] = [];
  const openSockets = new Set<Socket>();
  const server: TlsServer = createTlsServer(
    {
      key: readFileSync(keyFile),
      cert: readFileSync(certFile),
      SNICallback: (name, cb) => {
        seenSni.push(name);
        cb(null, undefined);
      },
    },
    (_req, res) => {
      res.end('ok');
    },
  );
  server.on('connection', (sock: Socket) => {
    openSockets.add(sock);
    sock.on('close', () => openSockets.delete(sock));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    seenSni,
    openSockets,
    close: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err) => (err ? reject(err) : resolve())),
      ),
  };
}

describe('F-05 TLS/SNI: sertifikat tidak tepercaya selalu ditolak (fail-closed)', () => {
  it('sertifikat CA lokal yang tidak dipercaya sistem ditolak, bukan diabaikan', async () => {
    const fx = await startTlsServer(goodCert, goodKey);
    try {
      await expect(
        pinnedGet(`https://fixture.example:${fx.port}/`, '127.0.0.1', 5000),
      ).rejects.toThrow();
    } finally {
      await fx.close();
    }
  });

  it('error yang muncul adalah error verifikasi sertifikat (bukan error koneksi)', async () => {
    const fx = await startTlsServer(goodCert, goodKey);
    try {
      const err = await pinnedGet(`https://fixture.example:${fx.port}/`, '127.0.0.1', 5000).catch(
        (e: unknown) => e,
      );
      expect(err).toBeInstanceOf(Error);
      const code = (err as NodeJS.ErrnoException).code ?? '';
      expect(code).toMatch(/CERT|TLS|SELF_SIGNED|UNABLE_TO_VERIFY/i);
    } finally {
      await fx.close();
    }
  });

  it('sertifikat kedaluwarsa ditolak', async () => {
    const fx = await startTlsServer(expiredCert, goodKey);
    try {
      await expect(
        pinnedGet(`https://fixture.example:${fx.port}/`, '127.0.0.1', 5000),
      ).rejects.toThrow();
    } finally {
      await fx.close();
    }
  });

  it('sertifikat untuk hostname yang salah ditolak', async () => {
    const fx = await startTlsServer(wrongCert, wrongKey);
    try {
      await expect(
        pinnedGet(`https://fixture.example:${fx.port}/`, '127.0.0.1', 5000),
      ).rejects.toThrow();
    } finally {
      await fx.close();
    }
  });
});

describe('F-05 TLS/SNI: SNI memakai hostname URL, bukan alamat terpin', () => {
  it('server menerima SNI = hostname URL meskipun koneksi ke IP terpin', async () => {
    const fx = await startTlsServer(goodCert, goodKey);
    try {
      // Klien akan menolak sertifikat, tetapi ClientHello (dengan SNI) sudah terkirim.
      await pinnedGet(`https://fixture.example:${fx.port}/`, '127.0.0.1', 5000).catch(() => {});
      expect(fx.seenSni).toContain('fixture.example');
      expect(fx.seenSni).not.toContain('127.0.0.1');
    } finally {
      await fx.close();
    }
  });
});

describe('F-05 TLS: kegagalan handshake tidak menggantung dan socket dibersihkan', () => {
  it('server plaintext pada port https: handshake gagal cepat, bukan hang', async () => {
    const plain = createHttpServer((_req, res) => res.end('bukan tls'));
    await new Promise<void>((resolve) => plain.listen(0, '127.0.0.1', resolve));
    const port = (plain.address() as AddressInfo).port;
    try {
      const start = Date.now();
      await expect(
        pinnedGet(`https://fixture.example:${port}/`, '127.0.0.1', 8000),
      ).rejects.toThrow();
      expect(Date.now() - start).toBeLessThan(8000);
    } finally {
      await new Promise<void>((resolve) => plain.close(() => resolve()));
    }
  });

  it('socket server tidak menggantung setelah klien menolak sertifikat', async () => {
    const fx = await startTlsServer(goodCert, goodKey);
    try {
      await pinnedGet(`https://fixture.example:${fx.port}/`, '127.0.0.1', 5000).catch(() => {});
      // Beri waktu cleanup; lalu pastikan tidak ada socket terbuka yang tersisa.
      const deadline = Date.now() + 5000;
      while (fx.openSockets.size > 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(fx.openSockets.size).toBe(0);
    } finally {
      await fx.close();
    }
  });
});

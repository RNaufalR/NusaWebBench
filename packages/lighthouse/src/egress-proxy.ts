import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';

/**
 * F-06: proxy forward lokal, per run, yang hanya meneruskan request ke origin target yang disetujui.
 *
 * Chrome diarahkan ke proxy ini untuk SEMUA request, termasuk loopback (`--proxy-bypass-list=<-loopback>`).
 * Bypass loopback implisit Chrome dimatikan karena konfigurasi `localhost;127.0.0.1;[::1]` terbukti
 * membiarkan subresource ke server loopback lain tanpa melewati proxy (lihat SECURITY_REMEDIATION_REPORT.md).
 *
 * Aturan: default tolak. Hanya pasangan host:port yang sama persis dengan origin target yang diteruskan.
 * Host dinormalisasi oleh parser URL (mis. `0177.0.0.1` -> `127.0.0.1`). `localhost` dan `127.0.0.1`
 * adalah entri berbeda; tidak ada wildcard.
 */

export type EgressProxy = {
  /** URL proxy untuk `--proxy-server`. */
  readonly proxyUrl: string;
  /** Target yang diteruskan dan target yang ditolak (host:port), tanpa path/query (tidak ada secret). */
  readonly denied: () => readonly string[];
  readonly allowed: () => readonly string[];
  readonly close: () => Promise<void>;
};

/** Kunci `host:port` kanonik. IPv6 disimpan dengan kurung siku, sesuai `URL.hostname`. */
export function originKey(url: URL): string {
  const port = url.port !== '' ? url.port : url.protocol === 'https:' ? '443' : '80';
  return `${url.hostname.toLowerCase()}:${port}`;
}

function connectKey(target: string): string | null {
  const m = /^(\[[^\]]+\]|[^:[\]]+):(\d{1,5})$/.exec(target);
  if (!m) return null;
  const port = Number(m[2]);
  if (port < 1 || port > 65535) return null;
  return `${(m[1] ?? '').toLowerCase()}:${port}`;
}

function stripBrackets(host: string): string {
  return host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
}

const HOP_HEADERS = new Set([
  'proxy-connection',
  'proxy-authorization',
  'connection',
  'keep-alive',
  'te',
  'trailer',
  'upgrade',
]);

/** Menjalankan proxy yang hanya mengizinkan `allowedUrl` (origin). Harus ditutup oleh pemanggil. */
export async function startEgressProxy(allowedUrls: readonly string[]): Promise<EgressProxy> {
  const allow = new Set<string>();
  for (const u of allowedUrls) {
    const parsed = new URL(u);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('EGRESS_PROXY_CONFIG: hanya http/https yang dapat diizinkan');
    }
    allow.add(originKey(parsed));
  }
  const denied = new Set<string>();
  const sockets = new Set<net.Socket>();

  const server = http.createServer((req, res) => {
    let target: URL;
    try {
      target = new URL(req.url ?? '');
    } catch {
      // Request langsung ke proxy (bukan absolute-form) tidak diizinkan.
      res.writeHead(400, { 'content-type': 'text/plain' }).end('bad request');
      return;
    }
    const key = originKey(target);
    if (target.protocol !== 'http:' || !allow.has(key)) {
      denied.add(key);
      res.writeHead(403, { 'content-type': 'text/plain' }).end('egress denied');
      return;
    }
    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (v !== undefined && !HOP_HEADERS.has(k)) headers[k] = v;
    }
    const upstream = http.request(
      {
        host: stripBrackets(target.hostname),
        port: Number(target.port || 80),
        method: req.method,
        path: `${target.pathname}${target.search}`,
        headers,
      },
      (ures) => {
        res.writeHead(ures.statusCode ?? 502, ures.headers);
        ures.pipe(res);
      },
    );
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain' });
      res.end('upstream error');
    });
    req.pipe(upstream);
  });

  // HTTPS hanya melalui CONNECT, dan hanya ke origin yang diizinkan.
  server.on('connect', (req, clientSocket, head) => {
    const key = connectKey(req.url ?? '');
    if (key === null || !allow.has(key)) {
      if (key !== null) denied.add(key);
      clientSocket.end('HTTP/1.1 403 Forbidden\r\nconnection: close\r\n\r\n');
      return;
    }
    const idx = key.lastIndexOf(':');
    const upstream = net.connect(
      Number(key.slice(idx + 1)),
      stripBrackets(key.slice(0, idx)),
      () => {
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
        if (head.length > 0) upstream.write(head);
        upstream.pipe(clientSocket);
        clientSocket.pipe(upstream);
      },
    );
    upstream.on('error', () => clientSocket.destroy());
    clientSocket.on('error', () => upstream.destroy());
    sockets.add(upstream);
    upstream.on('close', () => sockets.delete(upstream));
  });

  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const port = (server.address() as AddressInfo).port;

  return {
    proxyUrl: `http://127.0.0.1:${port}`,
    denied: () => [...denied].sort(),
    allowed: () => [...allow].sort(),
    close: () =>
      new Promise<void>((resolve) => {
        // Tutup koneksi aktif agar tidak ada proses/socket yang tertinggal setelah run.
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

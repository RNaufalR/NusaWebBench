import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { AppError } from '@nusawebbench/core';

export const LOOPBACK_HOSTS: readonly string[] = Object.freeze(['127.0.0.1', 'localhost', '::1']);

/** Server hanya boleh bind ke loopback. Alamat lain ditolak sebelum listen. */
export function assertLoopbackBind(host: string): void {
  if (!LOOPBACK_HOSTS.includes(host)) {
    throw new AppError('CONFIG_INVALID', {
      safeMessage: 'Dashboard hanya boleh bind ke loopback (127.0.0.1).',
      debugDetail: 'non-loopback-bind',
    });
  }
}

export async function startServer(
  handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>,
  options: { host: string; port: number },
): Promise<Server> {
  assertLoopbackBind(options.host);
  const server = createServer((req, res) => {
    handler(req, res).catch(() => {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' });
      }
      res.end(JSON.stringify({ error: 'INTERNAL', message: 'Terjadi kesalahan di server.' }));
    });
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, options.host, () => resolve(server));
  });
}

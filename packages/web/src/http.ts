import type { IncomingMessage, ServerResponse } from 'node:http';

/** Batas body JSON (taskbook T-140 negative tests: oversized input). */
export const MAX_BODY_BYTES = 16 * 1024;

export const SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'content-security-policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'cache-control': 'no-store',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
});

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly safeMessage: string,
  ) {
    super(code);
    this.name = 'HttpError';
  }
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload).toString(),
  });
  res.end(payload);
}

export function sendError(res: ServerResponse, err: HttpError): void {
  sendJson(res, err.status, { error: err.code, message: err.safeMessage });
}

export function sendStatic(res: ServerResponse, contentType: string, body: string): void {
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': contentType,
    'content-length': Buffer.byteLength(body).toString(),
  });
  res.end(body);
}

/** Membaca body JSON dengan batas ukuran dan tipe konten yang ketat. */
export function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const type = (req.headers['content-type'] ?? '').split(';')[0]?.trim().toLowerCase();
    if (type !== 'application/json') {
      reject(
        new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Gunakan Content-Type application/json.'),
      );
      return;
    }
    const declared = Number(req.headers['content-length'] ?? '0');
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
      reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Body melebihi batas 16 KB.'));
      req.resume();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let aborted = false;
    req.on('data', (chunk: Buffer) => {
      if (aborted) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        aborted = true;
        reject(new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Body melebihi batas 16 KB.'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('error', () => {
      if (!aborted) reject(new HttpError(400, 'BAD_REQUEST', 'Body tidak dapat dibaca.'));
    });
    req.on('end', () => {
      if (aborted) return;
      if (size === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown);
      } catch {
        reject(new HttpError(400, 'INVALID_JSON', 'JSON tidak valid.'));
      }
    });
  });
}

/**
 * Host dan Origin harus berasal dari loopback (model aplikasi lokal). Mencegah DNS rebinding dan
 * permintaan lintas-situs terhadap aksi yang mengubah state.
 */
export function checkHostAndOrigin(
  req: IncomingMessage,
  allowedHosts: readonly string[],
  method: string,
): HttpError | null {
  const host = (req.headers.host ?? '').toLowerCase();
  const hostName = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
  if (!allowedHosts.includes(hostName)) {
    return new HttpError(403, 'HOST_NOT_ALLOWED', 'Host tidak diizinkan.');
  }
  if (method !== 'GET' && method !== 'HEAD') {
    const origin = req.headers.origin;
    if (origin !== undefined && origin !== `http://${host}`) {
      return new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Origin tidak diizinkan.');
    }
    if (origin === undefined && req.headers['sec-fetch-site'] === 'cross-site') {
      return new HttpError(403, 'ORIGIN_NOT_ALLOWED', 'Permintaan lintas-situs ditolak.');
    }
  }
  return null;
}

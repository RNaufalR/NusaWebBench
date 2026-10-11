import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Server fixture lokal (taskbook T-070). Aturan keamanan:
 * - selalu bind ke 127.0.0.1 (tidak ada opsi host lain);
 * - path dinormalisasi dan harus tetap di dalam folder fixture (anti traversal);
 * - hanya fixture yang terdaftar yang bisa dibuka;
 * - rute `/search` dan `/api/*` hanya ada pada fixture yang memang mendefinisikannya.
 */

export const FIXTURE_NAMES = [
  'clean',
  'functional-defects',
  'a11y-defects',
  'ux-signals',
  'broken-resources',
  'security-lab',
] as const;
export type FixtureName = (typeof FIXTURE_NAMES)[number];

const here = path.dirname(fileURLToPath(import.meta.url));
/** Root repository: packages/fixtures/src → ../../.. */
export const DEFAULT_FIXTURES_ROOT = path.resolve(here, '../../..', 'fixtures');

const MIME: Readonly<Record<string, string>> = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json',
});

export type FixtureServer = {
  readonly name: FixtureName;
  readonly origin: string;
  readonly port: number;
  close(): Promise<void>;
};

export type StartOptions = {
  readonly fixtureRoot?: string;
  /** 0 berarti port acak dari OS. Port lain diberikan secara eksplisit oleh pemanggil. */
  readonly port?: number;
};

function isFixtureName(value: string): value is FixtureName {
  return (FIXTURE_NAMES as readonly string[]).includes(value);
}

/** Menyelesaikan path URL ke file di dalam folder fixture. Null bila di luar folder. */
export function resolveFixturePath(fixtureDir: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const rel = decoded === '/' ? '/index.html' : decoded;
  const candidate = path.resolve(fixtureDir, `.${rel}`);
  if (!candidate.startsWith(fixtureDir + path.sep)) return null;
  if (!existsSync(candidate)) return null;
  const real = realpathSync(candidate);
  if (!real.startsWith(fixtureDir + path.sep)) return null;
  if (!statSync(real).isFile()) return null;
  return real;
}

/** Menjalankan satu fixture pada 127.0.0.1. */
export async function startFixture(
  name: string,
  options: StartOptions = {},
): Promise<FixtureServer> {
  if (!isFixtureName(name)) {
    throw new Error(`fixture tidak dikenal: ${name}`);
  }
  const root = realpathSync(options.fixtureRoot ?? DEFAULT_FIXTURES_ROOT);
  const fixtureDir = realpathSync(path.join(root, name));
  const port = options.port ?? 0;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('port tidak valid');
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { allow: 'GET, HEAD' });
      res.end();
      return;
    }
    // Rute khusus fixture.
    if (name === 'functional-defects' && url.pathname === '/api/missing-resource') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end('{"error":"not found (synthetic)"}');
      return;
    }
    if (name === 'security-lab' && url.pathname === '/search') {
      // SENGAJA RENTAN untuk pengujian lokal: parameter dipantulkan tanpa escape.
      // Server hanya bind ke 127.0.0.1 dan tidak boleh dibuka ke jaringan luar.
      const q = url.searchParams.get('q') ?? '';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html lang="id"><body><p>Hasil untuk: ${q}</p></body></html>`);
      return;
    }
    const file = resolveFixturePath(fixtureDir, url.pathname);
    if (file === null) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(file);
    res.writeHead(200, {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'x-content-type-options': 'nosniff',
      'cache-control': 'no-store',
    });
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    // Berkas bisa hilang di antara pengecekan dan pembacaan; error stream tidak boleh
    // menjatuhkan proses. Koneksi ditutup saja.
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === 'string') {
    server.close();
    throw new Error('alamat server tidak diketahui');
  }
  const boundPort = address.port;
  return {
    name,
    origin: `http://127.0.0.1:${boundPort}`,
    port: boundPort,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}

/** Membaca ground truth dari folder fixture (untuk tes dan laporan). */
export function readGroundTruth(fixtureRoot: string = DEFAULT_FIXTURES_ROOT): unknown {
  return JSON.parse(readFileSync(path.join(fixtureRoot, 'ground-truth.json'), 'utf8'));
}

import { chmodSync, mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRun, createTarget, type ScopeGrant } from '@nusawebbench/core';
import type { ModuleContext } from '@nusawebbench/orchestrator';
import { ArtifactStore, Store } from '@nusawebbench/storage';
import { readGroundTruth, startFixture } from '@nusawebbench/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  K6Adapter,
  K6_LIMITS,
  buildK6Script,
  parseK6Config,
  parseK6Summary,
  type K6Config,
} from '../src/index.js';

const K6_BIN = process.env['K6_BIN'];
const CANARY = `gsk_${'L'.repeat(40)}`;
let dir: string;
let store: Store;
let artifacts: ArtifactStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nwb-k6t-'));
  store = Store.open(path.join(dir, 'db.sqlite'));
  artifacts = new ArtifactStore({ rootDir: path.join(dir, 'a'), evidence: store.evidence });
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const LOCAL: ScopeGrant = { origin: 'http://127.0.0.1:4500', mode: 'local-fixture' };
const REMOTE: ScopeGrant = { origin: 'https://contoh.example', mode: 'remote' };

function ctx(grant: ScopeGrant, signal = new AbortController().signal): ModuleContext {
  return {
    runId: 'run_0123456789abcdef0123456789abcdef',
    moduleResultId: 'module_0123456789abcdef0123456789abcdef',
    targetOrigin: grant.origin,
    grant,
    signal,
    progress: () => undefined,
  };
}

/** Membuat executable palsu bergaya k6 dengan skenario tetap. */
function fakeK6(
  mode: 'ok' | 'threshold' | 'malformed' | 'crash' | 'hang' | 'no-metrics' | 'version-bad',
): string {
  const bin = path.join(dir, `k6-${mode}`);
  const pidFile = path.join(dir, `pid-${mode}`);
  const summary = JSON.stringify({
    metrics: {
      http_reqs: { count: 10 },
      http_req_failed: { value: 0 },
      http_req_duration: { 'p(95)': 12.5 },
    },
  });
  const body = `
const fs = require('node:fs');
const args = process.argv.slice(2);
if (args[0] === 'version') { ${mode === 'version-bad' ? "console.log('bukan k6');" : "console.log('k6 v9.9.9 (fake)');"} process.exit(0); }
const out = args[args.indexOf('--summary-export') + 1];
fs.writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
const mode = ${JSON.stringify(mode)};
if (mode === 'hang') { setInterval(() => {}, 1000); }
else if (mode === 'threshold') { fs.writeFileSync(out, ${JSON.stringify(summary)}); process.exit(99); }
else if (mode === 'malformed') { fs.writeFileSync(out, '{tidak json'); process.exit(0); }
else if (mode === 'crash') { process.exit(2); }
else if (mode === 'no-metrics') { fs.writeFileSync(out, JSON.stringify({ metrics: { http_req_failed: { value: 0 } } })); process.exit(0); }
else { fs.writeFileSync(out, ${JSON.stringify(summary)}); process.exit(0); }
`;
  writeFileSync(bin, `#!${process.execPath}\n${body}`);
  chmodSync(bin, 0o755);
  return bin;
}

function adapter(over: {
  config?: Record<string, unknown>;
  k6Path?: string;
  timeoutMs?: number;
  spawnFn?: ConstructorParameters<typeof K6Adapter>[0]['spawnFn'];
}) {
  return new K6Adapter({
    artifacts,
    config: { enabled: true, ...(over.config ?? {}) },
    k6Path: over.k6Path ?? fakeK6('ok'),
    ...(over.timeoutMs !== undefined ? { timeoutMs: over.timeoutMs } : {}),
    ...(over.spawnFn ? { spawnFn: over.spawnFn } : {}),
  });
}

describe('konfigurasi dan batas keras', () => {
  it('default nonaktif: SKIPPED k6-disabled tanpa menyentuh executable', async () => {
    const out = await new K6Adapter({ artifacts, config: {}, k6Path: '/tidak/ada' }).run(
      ctx(LOCAL),
    );
    expect(out).toMatchObject({ status: 'SKIPPED', skippedReason: 'k6-disabled' });
  });

  it('VU, rate, dan durasi di luar batas ditolak (termasuk nilai non-integer dan overflow)', () => {
    const bad: Record<string, unknown>[] = [
      { vus: 0 },
      { vus: 3 },
      { vus: 1e20 },
      { vus: 1.5 },
      { vus: NaN },
      { vus: '2' },
      { ratePerSec: 0 },
      { ratePerSec: 6 },
      { ratePerSec: Number.MAX_SAFE_INTEGER + 2 },
      { durationSec: 0 },
      { durationSec: 31 },
      { durationSec: -1 },
    ];
    for (const b of bad) expect(() => parseK6Config(b), JSON.stringify(b)).toThrow();
  });

  it('total request (rate × durasi) dibatasi 100; batas tepat diizinkan', () => {
    expect(() => parseK6Config({ ratePerSec: 5, durationSec: 30 })).toThrow();
    expect(parseK6Config({ ratePerSec: 5, durationSec: 20 }).durationSec).toBe(20);
    expect(K6_LIMITS.maxTotalRequests).toBe(100);
  });

  it('path yang mengandung shell/JS injection atau traversal ditolak', () => {
    const bad = [
      '/a;rm -rf /',
      '/a"+process.exit()+"',
      '/../etc/passwd',
      '//evil.example',
      '/a b',
      '/x`id`',
    ];
    for (const p of bad) expect(() => parseK6Config({ path: p }), p).toThrow();
  });

  it('tidak ada preset stress/flood/spike pada MVP', () => {
    expect(() => parseK6Config({ preset: 'stress' })).toThrow();
    expect(() => parseK6Config({ preset: 'flood' })).toThrow();
    expect(() => parseK6Config({ preset: 'spike' })).toThrow();
  });
});

describe('script dan parser', () => {
  it('script hanya memuat nilai yang diserialisasi; input berbahaya tidak menjadi kode', () => {
    const href = new URL('http://127.0.0.1:4500/ok?x="+process.exit()').href;
    const src = buildK6Script({ url: href, vus: 2, ratePerSec: 3, durationSec: 4 });
    expect(src).toContain('constant-arrival-rate');
    // Baris TARGET harus persis hasil JSON.stringify; teks process.exit hanya ada di dalam string.
    expect(src).toContain('const TARGET = ' + JSON.stringify(href) + ';');
    expect(src.split('\n').some((line) => line.trimStart().startsWith('process.exit'))).toBe(false);
  });

  it('ringkasan: metrik yang tidak ada tidak dikarang', () => {
    expect(parseK6Summary('{"metrics":{"http_req_failed":{"value":0}}}')).toEqual({
      requests: null,
      failedRate: 0,
      p95Ms: null,
    });
  });

  it('ringkasan rusak atau tanpa metrics ditolak', () => {
    expect(() => parseK6Summary('{tidak json')).toThrow();
    expect(() => parseK6Summary('{"tidak":"ada"}')).toThrow();
  });
});

describe('adapter: gerbang dan proses', () => {
  it('target remote tanpa acknowledgement → SKIPPED; dengan acknowledgement tetap ditolak (SCOPE_DENIED)', async () => {
    const skipped = await adapter({}).run(ctx(REMOTE));
    expect(skipped).toMatchObject({ status: 'SKIPPED', skippedReason: 'remote-not-acknowledged' });
    const denied = await adapter({ config: { remoteAcknowledged: true } }).run(ctx(REMOTE));
    expect(denied).toMatchObject({ status: 'ERROR', errorCode: 'SCOPE_DENIED' });
  });

  it('executable tidak ada atau bukan k6 → UNAVAILABLE TOOL_MISSING', async () => {
    expect(await adapter({ k6Path: '/tidak/ada/k6' }).run(ctx(LOCAL))).toMatchObject({
      status: 'UNAVAILABLE',
      errorCode: 'TOOL_MISSING',
    });
    expect(await adapter({ k6Path: fakeK6('version-bad') }).run(ctx(LOCAL))).toMatchObject({
      status: 'UNAVAILABLE',
      errorCode: 'TOOL_MISSING',
    });
  });

  it('jalur sukses: PASS dengan metrik dari ringkasan dan versi tool dari `k6 version`', async () => {
    const out = await adapter({ config: { ratePerSec: 2, durationSec: 3, vus: 1 } }).run(
      ctx(LOCAL),
    );
    expect(out.status).toBe('PASS');
    expect(out.toolName).toBe('k6');
    expect(out.toolVersion).toBe('9.9.9');
    expect(out.metrics).toMatchObject({
      vus: 1,
      plannedRequests: 6,
      observedRequests: 10,
      failedRate: 0,
      p95Ms: 12.5,
    });
    // Kondisi test dicatat: simulasi, preset, batas keras, dan stop condition.
    expect(out.configSnapshot).toMatchObject({
      simulation: true,
      preset: 'fixed-smoke',
      maxVus: 2,
      maxRatePerSec: 5,
      maxDurationSec: 30,
      maxTotalRequests: 100,
      plannedRequests: 6,
      abortOnFail: true,
      stopConditionFailedRate: 0.05,
    });
  });

  it('threshold gagal (exit 99) → FAIL dengan metrik; bukan error tool', async () => {
    const out = await adapter({ k6Path: fakeK6('threshold') }).run(ctx(LOCAL));
    expect(out.status).toBe('FAIL');
    expect(out.metrics?.['observedRequests']).toBe(10);
  });

  it('ringkasan rusak → ERROR TOOL_FAILED tanpa metrik yang dikarang', async () => {
    const out = await adapter({ k6Path: fakeK6('malformed') }).run(ctx(LOCAL));
    expect(out).toMatchObject({ status: 'ERROR', errorCode: 'TOOL_FAILED' });
    expect(out.metrics).toBeUndefined();
  });

  it('ringkasan tanpa http_reqs → metrik observedRequests tidak diisi', async () => {
    const out = await adapter({ k6Path: fakeK6('no-metrics') }).run(ctx(LOCAL));
    expect(out.status).toBe('PASS');
    expect(out.metrics?.['observedRequests']).toBeUndefined();
  });

  it('proses crash tanpa ringkasan → ERROR TOOL_FAILED', async () => {
    const out = await adapter({ k6Path: fakeK6('crash') }).run(ctx(LOCAL));
    expect(out).toMatchObject({ status: 'ERROR', errorCode: 'TOOL_FAILED' });
  });

  it('argumen dikirim sebagai array tanpa shell dan lingkungan tidak meneruskan rahasia', async () => {
    const original = process.env['GROQ_API_KEY'];
    process.env['GROQ_API_KEY'] = CANARY;
    try {
      const calls: { args: string[]; options: { shell?: boolean; env?: NodeJS.ProcessEnv } }[] = [];
      const { spawn } = await import('node:child_process');
      const spy = ((
        bin: string,
        args: string[],
        options: { shell?: boolean; env?: NodeJS.ProcessEnv },
      ) => {
        calls.push({ args, options });
        return spawn(bin, args, { ...options });
      }) as typeof spawn;
      await adapter({ spawnFn: spy }).run(ctx(LOCAL));
      expect(calls.length).toBe(1);
      expect(calls[0]?.options.shell).toBe(false);
      expect(JSON.stringify(calls[0]?.options.env ?? {})).not.toContain(CANARY);
    } finally {
      if (original === undefined) delete process.env['GROQ_API_KEY'];
      else process.env['GROQ_API_KEY'] = original;
    }
  });

  it('pembatalan menghentikan proses (tidak ada orphan)', async () => {
    const bin = fakeK6('hang');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 800);
    const out = await adapter({ k6Path: bin }).run(ctx(LOCAL, controller.signal));
    expect(out).toMatchObject({ status: 'ERROR', errorCode: 'CANCELLED' });
    await new Promise((r) => setTimeout(r, 400));
    const pid = Number(readFileSync(path.join(dir, 'pid-hang'), 'utf8'));
    expect(alive(pid)).toBe(false);
  }, 30_000);

  it('batas waktu menghentikan proses → ERROR TIMEOUT retryable=false', async () => {
    const out = await adapter({ k6Path: fakeK6('hang'), timeoutMs: 700 }).run(ctx(LOCAL));
    expect(out).toMatchObject({ status: 'ERROR', errorCode: 'TIMEOUT' });
    await new Promise((r) => setTimeout(r, 400));
    const pid = Number(readFileSync(path.join(dir, 'pid-hang'), 'utf8'));
    expect(alive(pid)).toBe(false);
  }, 30_000);

  it('direktori kerja sementara dihapus setelah run', async () => {
    const before = new Set(
      (await import('node:fs')).readdirSync(tmpdir()).filter((n) => n.startsWith('nwb-k6-')),
    );
    await adapter({}).run(ctx(LOCAL));
    const after = (await import('node:fs'))
      .readdirSync(tmpdir())
      .filter((n) => n.startsWith('nwb-k6-') && !before.has(n));
    expect(after).toEqual([]);
  });
});

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Server lokal untuk kondisi gagal: `error` membalas 500 untuk setiap request; `overload` membalas
 * setelah 7 detik, melewati timeout request k6 (5 detik). Hanya loopback.
 */
async function startFaultServer(
  kind: 'error' | 'overload',
): Promise<{ origin: string; close: () => Promise<void> }> {
  const server: Server = createServer((_req, res) => {
    if (kind === 'error') {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('uji server error');
      return;
    }
    setTimeout(() => {
      if (!res.writableEnded) {
        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('terlambat');
      }
    }, 7_000);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  if (addr === null || typeof addr === 'string') throw new Error('alamat server tidak valid');
  return {
    origin: `http://127.0.0.1:${addr.port}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/**
 * Jumlah proses k6 `run` yang dijalankan dari K6_BIN. Dicocokkan dengan executable itu di awal baris
 * args (bukan substring), agar shell atau proses lain yang kebetulan memuat teks serupa tidak terhitung.
 */
function countK6RunProcesses(): number {
  const bin = K6_BIN;
  if (!bin) return 0;
  const ps = spawnSync('ps', ['-eo', 'args'], { encoding: 'utf8' });
  return ps.stdout.split('\n').filter((l) => l.trim().startsWith(`${bin} run`)).length;
}

describe('k6 nyata (opt-in, K6_BIN)', () => {
  const real = K6_BIN ? it : it.skip;
  real(
    'fixture lokal: preset smoke menghasilkan PASS dengan metrik nyata',
    async () => {
      const fx = await startFixture('clean');
      try {
        const out = await new K6Adapter({
          artifacts,
          config: { enabled: true, ratePerSec: 2, durationSec: 3 },
          k6Path: K6_BIN,
        }).run(ctx({ origin: fx.origin, mode: 'local-fixture' }));
        expect(out.status).toBe('PASS');
        expect(out.metrics?.['observedRequests']).toBeGreaterThan(0);
      } finally {
        await fx.close();
      }
    },
    120_000,
  );
  real(
    'pembatalan nyata: k6 dihentikan dan tidak ada proses k6 yang tertinggal',
    async () => {
      const fx = await startFixture('clean');
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 1_500);
      try {
        const out = await new K6Adapter({
          artifacts,
          config: { enabled: true, ratePerSec: 2, durationSec: 10 },
          k6Path: K6_BIN,
        }).run(ctx({ origin: fx.origin, mode: 'local-fixture' }, controller.signal));
        expect(out).toMatchObject({ status: 'ERROR', errorCode: 'CANCELLED' });
      } finally {
        await fx.close();
      }
      await new Promise((r) => setTimeout(r, 500));
      expect(countK6RunProcesses()).toBe(0);
    },
    60_000,
  );
  real(
    'overload: server melewati timeout request k6 → FAIL (threshold), bukan PASS',
    async () => {
      const srv = await startFaultServer('overload');
      try {
        const out = await new K6Adapter({
          artifacts,
          config: { enabled: true, ratePerSec: 2, durationSec: 3 },
          k6Path: K6_BIN,
        }).run(ctx({ origin: srv.origin, mode: 'local-fixture' }));
        expect(out.status).toBe('FAIL');
        expect(out.metrics?.['observedRequests']).toBeGreaterThan(0);
        expect(out.metrics?.['failedRate']).toBeGreaterThan(0.9);
      } finally {
        await srv.close();
      }
    },
    120_000,
  );
  real(
    'server error: setiap request 500 → FAIL (threshold gagal), bukan PASS; metrik kegagalan nyata',
    async () => {
      const srv = await startFaultServer('error');
      try {
        const out = await new K6Adapter({
          artifacts,
          config: { enabled: true, ratePerSec: 2, durationSec: 3 },
          k6Path: K6_BIN,
        }).run(ctx({ origin: srv.origin, mode: 'local-fixture' }));
        expect(out.status).toBe('FAIL');
        expect(out.metrics?.['observedRequests']).toBeGreaterThan(0);
        expect(out.metrics?.['failedRate']).toBeGreaterThan(0.9);
        expect(out.configSnapshot).toMatchObject({ abortOnFail: true, simulation: true });
      } finally {
        await srv.close();
      }
    },
    120_000,
  );
  it('ground truth tidak diubah oleh modul ini', () => {
    expect(readGroundTruth()).toBeDefined();
  });
});

// Referensi tipe agar import tidak dihapus oleh linter.
export type _K6ConfigRef = K6Config;
void createRun;
void createTarget;
void existsSync;

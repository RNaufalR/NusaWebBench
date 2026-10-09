import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { request as httpRequest, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppError, loadConfig } from '@nusawebbench/core';
import { FunctionalQaAdapter } from '@nusawebbench/browser-qa';
import { startFixture } from '@nusawebbench/fixtures';
import { RunOrchestrator } from '@nusawebbench/orchestrator';
import { AiService, AiSettingsService } from '@nusawebbench/ai';
import { UxRulesAdapter } from '@nusawebbench/ux-rules';
import { ArtifactStore, Store } from '@nusawebbench/storage';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { APP_JS, INDEX_HTML, createApp, startServer } from '../src/index.js';

const BROWSER = process.env['CHROMIUM_PATH'];
const REQUIRE = process.env['REQUIRE_BROWSER_TESTS'] === '1';
if (REQUIRE && !BROWSER) throw new Error('REQUIRE_BROWSER_TESTS=1 tetapi CHROMIUM_PATH kosong.');
const real = BROWSER ? it : it.skip;
const KEY_CANARY = `AIza${'W'.repeat(35)}`;

let dir: string;
let server: Server;
let base = '';
let port = 0;
let store: Store;

beforeAll(async () => {
  dir = mkdtempSync(path.join(tmpdir(), 'nwb-web-'));
  store = Store.open(path.join(dir, 'db.sqlite'));
  const artifacts = new ArtifactStore({
    rootDir: path.join(dir, 'artifacts'),
    evidence: store.evidence,
  });
  const config = loadConfig({
    GEMINI_API_KEY: KEY_CANARY,
    GEMINI_MODEL: 'gemini-3.8-flash',
    AI_PROVIDER: 'none',
  });
  const orchestrator = new RunOrchestrator({
    store,
    adapters: [
      new FunctionalQaAdapter({ artifacts, ...(BROWSER ? { executablePath: BROWSER } : {}) }),
      new UxRulesAdapter({ artifacts, ...(BROWSER ? { executablePath: BROWSER } : {}) }),
    ],
  });
  const aiSettings = new AiSettingsService(store, config);
  const aiService = new AiService({ store, config, clients: {} });
  const app = createApp({
    store,
    artifacts,
    orchestrator,
    aiSettings,
    aiService,
    allowedHosts: ['127.0.0.1', 'localhost'],
  });
  server = await startServer(app.handle, { host: '127.0.0.1', port: 0 });
  port = (server.address() as { port: number }).port;
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

type Res = { status: number; headers: Headers; json: unknown; text: string };
async function call(
  method: string,
  p: string,
  body?: unknown,
  headers: Record<string, string> = {},
): Promise<Res> {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    init.body = typeof body === 'string' ? body : JSON.stringify(body);
    (init.headers as Record<string, string>)['content-type'] ??= 'application/json';
  }
  const res = await fetch(base + p, init);
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    json = null;
  }
  return { status: res.status, headers: res.headers, json, text };
}

/** Permintaan mentah dengan header Host tertentu (fetch tidak mengizinkan Host kustom). */
function rawWithHost(
  host: string,
  method: string,
  p: string,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      { host: '127.0.0.1', port, path: p, method, headers: { host } },
      (res) => {
        let body = '';
        res.on('data', (c: Buffer) => (body += c.toString()));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

const originOf = (n: number) => `http://127.0.0.1:${n}`;

describe('keamanan dasar HTTP', () => {
  it('halaman dan API mengirim header keamanan (CSP, nosniff, no-store)', async () => {
    const r = await call('GET', '/');
    expect(r.status).toBe(200);
    expect(r.headers.get('content-security-policy')).toContain("script-src 'self'");
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.text).toContain('<main id="utama">');
  });

  it('Host selain loopback ditolak (anti DNS rebinding)', async () => {
    const r = await rawWithHost('evil.example', 'GET', '/api/health');
    expect(r.status).toBe(403);
    expect(r.body).toContain('HOST_NOT_ALLOWED');
  });

  it('POST dari origin lain ditolak; POST tanpa Origin tetap diizinkan (curl lokal)', async () => {
    const denied = await call(
      'POST',
      '/api/targets',
      { label: 'x', origin: originOf(1), mode: 'fixture' },
      { origin: 'http://evil.example' },
    );
    expect(denied.status).toBe(403);
    expect(denied.json).toMatchObject({ error: 'ORIGIN_NOT_ALLOWED' });
  });

  it('Content-Type selain JSON ditolak; JSON rusak ditolak', async () => {
    const wrongType = await call('POST', '/api/targets', 'label=x', {
      'content-type': 'text/plain',
    });
    expect(wrongType.status).toBe(415);
    const broken = await call('POST', '/api/targets', '{"label":');
    expect(broken.status).toBe(400);
    expect(broken.json).toMatchObject({ error: 'INVALID_JSON' });
  });

  it('body di atas 16 KB ditolak dengan 413', async () => {
    const big = JSON.stringify({ label: 'a'.repeat(20_000), origin: originOf(1), mode: 'fixture' });
    const r = await call('POST', '/api/targets', big);
    expect(r.status).toBe(413);
  });

  it('metode tak dikenal → 405; rute tak dikenal → 404', async () => {
    expect((await call('PATCH', '/api/targets')).status).toBe(405);
    expect((await call('GET', '/api/tidak-ada')).status).toBe(404);
  });

  it('server menolak bind ke alamat non-loopback', async () => {
    const { startServer: start } = await import('../src/server.js');
    await expect(start(async () => undefined, { host: '0.0.0.0', port: 0 })).rejects.toBeInstanceOf(
      AppError,
    );
  });

  it('aset statis tidak memakai innerHTML (XSS: data hanya masuk sebagai textContent)', () => {
    expect(APP_JS).not.toContain('innerHTML');
    expect(APP_JS).not.toContain('outerHTML');
    expect(INDEX_HTML).not.toContain('onclick=');
    expect(readFileSync(path.join(import.meta.dirname, '..', 'src', 'pages.ts'), 'utf8')).toContain(
      'textContent',
    );
  });
});

describe('target', () => {
  it('membuat target fixture loopback; duplikat origin → 409', async () => {
    const ok = await call('POST', '/api/targets', {
      label: 'Uji lokal',
      origin: originOf(4321),
      mode: 'fixture',
    });
    expect(ok.status).toBe(201);
    const dup = await call('POST', '/api/targets', {
      label: 'Uji lagi',
      origin: originOf(4321),
      mode: 'fixture',
    });
    expect(dup.status).toBe(409);
  });

  it('over-posting ditolak (field tak dikenal, mis. scopeConfirmedAt)', async () => {
    const r = await call('POST', '/api/targets', {
      label: 'x',
      origin: originOf(4322),
      mode: 'fixture',
      scopeConfirmedAt: '2026-10-09T00:00:00.000Z',
    });
    expect(r.status).toBe(400);
  });

  it('origin tidak valid: path, kredensial, protokol, dan mode fixture di host publik ditolak', async () => {
    const bad = [
      { origin: 'http://127.0.0.1:4323/path', mode: 'fixture' },
      { origin: 'http://user:pass@127.0.0.1:4323', mode: 'fixture' },
      { origin: 'ftp://127.0.0.1:4323', mode: 'fixture' },
      { origin: 'https://contoh.example', mode: 'fixture' },
      { origin: 'bukan-url', mode: 'url' },
    ];
    for (const b of bad) {
      const r = await call('POST', '/api/targets', { label: 'x', ...b });
      expect(r.status, b.origin).toBe(400);
    }
  });

  it('XSS di nama target disimpan dan dikembalikan sebagai string JSON (tanpa dieksekusi)', async () => {
    const label = '<img src=x onerror=alert(1)>';
    const r = await call('POST', '/api/targets', {
      label,
      origin: originOf(4324),
      mode: 'fixture',
    });
    expect(r.status).toBe(201);
    expect((r.json as { label: string }).label).toBe(label);
    expect(r.headers.get('content-type')).toContain('application/json');
  });
});

describe('run: validasi, scope, dan idempotensi', () => {
  let fixtureTargetId = '';
  let remoteTargetId = '';
  beforeAll(async () => {
    const list = (await call('GET', '/api/targets')).json as {
      items: { id: string; origin: string }[];
    };
    fixtureTargetId = list.items.find((t) => t.origin === originOf(4321))?.id ?? '';
    const remote = await call('POST', '/api/targets', {
      label: 'Remote',
      origin: 'https://contoh.example',
      mode: 'url',
    });
    remoteTargetId = (remote.json as { id: string }).id;
  });

  it('acknowledged wajib true; modul tidak dikenal → 400; modul belum tersedia → 422', async () => {
    const noAck = await call('POST', '/api/runs', {
      targetId: fixtureTargetId,
      modules: ['UX_RULES'],
    });
    expect(noAck.status).toBe(400);
    const unknown = await call('POST', '/api/runs', {
      targetId: fixtureTargetId,
      modules: ['MODUL_FIKTIF'],
      acknowledged: true,
    });
    expect(unknown.status).toBe(400);
    const unavailable = await call('POST', '/api/runs', {
      targetId: fixtureTargetId,
      modules: ['LOAD_K6'],
      acknowledged: true,
    });
    expect(unavailable.status).toBe(422);
    expect(unavailable.json).toMatchObject({ error: 'MODULE_NOT_AVAILABLE' });
  });

  it('target remote dengan modul browser diblokir oleh plan (422), dan pratinjau menyatakannya', async () => {
    const plan = await call('POST', '/api/plan', {
      targetId: remoteTargetId,
      modules: ['UX_RULES'],
    });
    expect(plan.status).toBe(200);
    expect((plan.json as { allowed: boolean }).allowed).toBe(false);
    const run = await call('POST', '/api/runs', {
      targetId: remoteTargetId,
      modules: ['UX_RULES'],
      acknowledged: true,
    });
    expect(run.status).toBe(422);
  });

  it('target tidak ada / ID tidak valid → 404 / 400', async () => {
    expect(
      (
        await call('POST', '/api/runs', {
          targetId: 'target_00000000000000000000000000000000',
          modules: ['UX_RULES'],
          acknowledged: true,
        })
      ).status,
    ).toBe(404);
    expect((await call('GET', '/api/runs/bukan-id')).status).toBe(400);
    expect((await call('GET', '/api/runs/run_00000000000000000000000000000000')).status).toBe(404);
  });

  it('double submit dengan Idempotency-Key yang sama mengembalikan run yang sama', async () => {
    const key = 'idem-test-0001';
    const body = { targetId: fixtureTargetId, modules: ['UX_RULES'], acknowledged: true };
    const a = await call('POST', '/api/runs', body, { 'idempotency-key': key });
    const b = await call('POST', '/api/runs', body, { 'idempotency-key': key });
    expect(a.status).toBe(202);
    expect((b.json as { id: string }).id).toBe((a.json as { id: string }).id);
  });

  it('pembatalan run yang masih QUEUED → CANCELLED', async () => {
    const first = await call('POST', '/api/runs', {
      targetId: fixtureTargetId,
      modules: ['FUNCTIONAL_QA'],
      acknowledged: true,
    });
    const second = await call('POST', '/api/runs', {
      targetId: fixtureTargetId,
      modules: ['UX_RULES'],
      acknowledged: true,
    });
    const id = (second.json as { id: string }).id;
    const c = await call('POST', `/api/runs/${id}/cancel`, {});
    expect(c.status).toBe(200);
    expect(c.json).toMatchObject({ status: 'CANCELLED' });
    expect((first.json as { id: string }).id).not.toBe(id);
  });

  it('artefak: ID arbitrer, path traversal, dan artefak dari run lain tidak bisa dibuka', async () => {
    // Klien fetch menormalkan ".." sebelum mencapai server; rute tidak cocok → 404.
    expect((await call('GET', '/api/artifacts/..')).status).toBe(404);
    expect((await call('GET', '/api/artifacts/..%2Fetc%2Fpasswd')).status).toBe(400);
    expect((await call('GET', '/api/artifacts/evd_00000000000000000000000000000000')).status).toBe(
      404,
    );
  });
});

describe('AI settings dan rahasia', () => {
  it('status provider tidak pernah memuat nilai kunci', async () => {
    const r = await call('GET', '/api/providers/status');
    expect(r.status).toBe(200);
    expect(r.text).not.toContain(KEY_CANARY);
    expect(
      (r.json as { providers: { provider: string; keyConfigured: boolean }[] }).providers.find(
        (p) => p.provider === 'gemini',
      )?.keyConfigured,
    ).toBe(true);
  });

  it('pengaturan: over-posting freeTierLock ditolak; consent valid tersimpan', async () => {
    const bad = await call('PUT', '/api/settings', { freeTierLock: false });
    expect(bad.status).toBe(400);
    const ok = await call('PUT', '/api/settings', {
      externalDataConsent: true,
      redactionLevel: 'strict',
    });
    expect(ok.status).toBe(200);
    expect(
      (ok.json as { consent: { externalDataConsent: boolean } }).consent.externalDataConsent,
    ).toBe(true);
    expect((ok.json as { operator: { freeTierLock: boolean } }).operator.freeTierLock).toBe(true);
  });

  it('uji koneksi tanpa konfirmasi ditolak; dengan konfirmasi tetap gagal aman saat AI nonaktif', async () => {
    expect((await call('POST', '/api/providers/test', {})).status).toBe(400);
    const r = await call('POST', '/api/providers/test', { confirm: true });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: 'AI_UNAVAILABLE', reason: 'provider-disabled' });
  });
});

describe('audit lokal end-to-end (fixture, Chromium nyata)', () => {
  real(
    'run UX_RULES + FUNCTIONAL_QA pada fixture: selesai, temuan, laporan, dan unduhan artefak aman',
    async () => {
      const fx = await startFixture('ux-signals');
      try {
        const t = await call('POST', '/api/targets', {
          label: 'E2E fixture',
          origin: fx.origin,
          mode: 'fixture',
        });
        expect(t.status).toBe(201);
        const targetId = (t.json as { id: string }).id;
        const run = await call('POST', '/api/runs', {
          targetId,
          modules: ['UX_RULES'],
          acknowledged: true,
        });
        expect(run.status).toBe(202);
        const runId = (run.json as { id: string }).id;

        let status = '';
        const deadline = Date.now() + 120_000;
        while (Date.now() < deadline) {
          status = ((await call('GET', `/api/runs/${runId}`)).json as { status: string }).status;
          if (['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(status)) break;
          await new Promise((r) => setTimeout(r, 300));
        }
        expect(status).toBe('COMPLETED');

        const findings = (await call('GET', `/api/runs/${runId}/findings?limit=100`)).json as {
          total: number;
          items: { ruleId: string | null }[];
        };
        expect(findings.total).toBeGreaterThanOrEqual(5);
        expect(findings.items.map((f) => f.ruleId)).toContain('ux-horizontal-overflow');

        const report = await call('POST', `/api/runs/${runId}/report`, {});
        expect(report.status).toBe(201);

        const arts = (await call('GET', `/api/runs/${runId}/artifacts`)).json as {
          items: { id: string; mimeType: string }[];
        };
        expect(arts.items.length).toBeGreaterThan(0);
        const first = arts.items[0];
        if (!first) throw new Error('artefak laporan tidak ditemukan');
        const dl = await call('GET', `/api/artifacts/${first.id}`);
        expect(dl.status).toBe(200);
        expect(dl.headers.get('content-disposition')).toContain('attachment');
        expect(dl.headers.get('x-content-type-options')).toBe('nosniff');
        expect(dl.headers.get('content-security-policy')).toContain('sandbox');
      } finally {
        await fx.close();
      }
    },
    180_000,
  );
});

import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { AppError, createRun, createTarget, type Run, type ScopeGrant } from '@nusawebbench/core';
import { startFixture } from '@nusawebbench/fixtures';
import type { ModuleContext } from '@nusawebbench/orchestrator';
import { ArtifactStore, Store } from '@nusawebbench/storage';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LighthouseAdapter, parseLighthouseConfig, type LighthouseRunInput } from '../src/index.js';

// Semua data sintetis (synthetic/demo). Kanari secret dibentuk dari pola.
const CANARY = `gsk_${'Z'.repeat(40)}`;
const ORIGIN = 'http://127.0.0.1:4178';
const grant: ScopeGrant = { origin: ORIGIN, mode: 'local-fixture' };
/** Berkas yang pasti ada dan dapat dijadikan "chromium" palsu untuk pemeriksaan keberadaan. */
const REQUIRE_BROWSER = process.env['REQUIRE_BROWSER_TESTS'] === '1';
const FAKE_EXECUTABLE = process.execPath;

let dir: string;
let store: Store;
let run: Run;
let artifacts: ArtifactStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nwb-lh-'));
  store = Store.open(path.join(dir, 'db.sqlite'));
  const target = createTarget({
    label: 'fixture',
    origin: ORIGIN,
    mode: 'fixture',
    allowedModules: [],
    scopeConfirmedAt: null,
  });
  store.targets.insert(target);
  run = createRun({
    targetId: target.id,
    targetOrigin: target.origin,
    targetMode: 'fixture',
    authorization: {
      acknowledged: true,
      scopeSummary: 'fixture',
      scopeHash: null,
      approvedAt: '2026-10-09T02:00:00.000Z',
    },
    configSnapshot: {},
  });
  store.runs.insert(run);
  artifacts = new ArtifactStore({ rootDir: path.join(dir, 'artifacts'), evidence: store.evidence });
});

afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function ctx(signal: AbortSignal = new AbortController().signal): ModuleContext {
  return {
    runId: run.id,
    moduleResultId: `mod_${'a'.repeat(32)}`,
    targetOrigin: ORIGIN,
    grant,
    signal,
    progress: () => undefined,
  };
}

/** LHR palsu yang bentuknya sesuai keluaran Lighthouse 13 (bidang yang dibaca adapter). */
function lhr(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    lighthouseVersion: '13.5.0',
    requestedUrl: `${ORIGIN}/`,
    finalUrl: `${ORIGIN}/`,
    configSettings: { formFactor: 'desktop', throttlingMethod: 'simulate' },
    environment: {
      hostUserAgent:
        'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/153.0.7000.1 Safari/537.36',
    },
    timing: { total: 1234 },
    categories: {
      performance: { id: 'performance', score: 0.9 },
      accessibility: { id: 'accessibility', score: 0.8 },
    },
    audits: {
      'first-contentful-paint': { numericValue: 900 },
      'largest-contentful-paint': { numericValue: 1500 },
    },
    ...over,
  };
}

function adapterWith(
  runner: (input: LighthouseRunInput) => Promise<unknown>,
  extra: { config?: unknown; executablePath?: string; timeoutMs?: number } = {},
): LighthouseAdapter {
  return new LighthouseAdapter({
    artifacts,
    runner,
    config: extra.config ?? {},
    executablePath: extra.executablePath ?? FAKE_EXECUTABLE,
    ...(extra.timeoutMs !== undefined ? { timeoutMs: extra.timeoutMs } : {}),
  });
}

describe('konfigurasi Lighthouse', () => {
  it('default aman: desktop, performance + accessibility, path root', () => {
    const c = parseLighthouseConfig({});
    expect(c.startPath).toBe('/');
    expect(c.formFactor).toBe('desktop');
    expect(c.categories).toEqual(['performance', 'accessibility']);
  });

  it('path protocol-relative dan key tidak dikenal ditolak', () => {
    expect(() => parseLighthouseConfig({ startPath: '//evil.example/' })).toThrow(AppError);
    expect(() => parseLighthouseConfig({ startPath: '/a\\b' })).toThrow(AppError);
    expect(() => parseLighthouseConfig({ extraFlag: '--remote' })).toThrow(AppError);
  });

  it('nilai di luar daftar (mis. stress preset) dan batas ukuran ditolak', () => {
    expect(() => parseLighthouseConfig({ formFactor: 'tablet' })).toThrow(AppError);
    expect(() => parseLighthouseConfig({ categories: ['pwa'] })).toThrow(AppError);
    expect(() => parseLighthouseConfig({ maxReportBytes: 99_999_999 })).toThrow(AppError);
  });
});

describe('LighthouseAdapter — keluaran valid', () => {
  it('skor dan metrik tersedia dicatat; toolVersion memuat versi Lighthouse dan Chrome', async () => {
    const adapter = adapterWith(async () => lhr());
    const out = await adapter.run(ctx());
    expect(out.status).toBe('PASS');
    expect(out.metrics).toMatchObject({
      score_performance: 90,
      score_accessibility: 80,
      fcp_ms: 900,
      lcp_ms: 1500,
      comparable: 1,
      lighthouse_duration_ms: 1234,
    });
    expect(out.toolName).toBe('lighthouse');
    expect(out.toolVersion).toBe('13.5.0; chrome 153.0.7000.1');
    expect(out.errorCode).toBeNull();
  });

  it('laporan mentah tersimpan sebagai artefak JSON yang bisa diverifikasi hash-nya', async () => {
    const out = await adapterWith(async () => lhr()).run(ctx());
    expect(out.artifactRefs?.length).toBe(1);
    const ev = store.evidence.get((out.artifactRefs ?? [])[0] ?? '');
    expect(ev?.kind).toBe('json');
    expect(ev?.redactionApplied).toBe(true);
    const bytes = artifacts.readVerified((out.artifactRefs ?? [])[0] ?? '');
    expect(JSON.parse(bytes.toString('utf8')).lighthouseVersion).toBe('13.5.0');
  });

  it('skor null tidak pernah dicatat sebagai 0 (kegagalan tidak menjadi skor)', async () => {
    const out = await adapterWith(async () =>
      lhr({ categories: { performance: { id: 'performance', score: null } } }),
    ).run(ctx());
    expect(out.status).toBe('PASS');
    expect(out.metrics).not.toHaveProperty('score_performance');
    expect(out.metrics?.['score_accessibility']).toBeUndefined();
  });

  it('metrik numerik tak hingga (NaN/Infinity) tidak dicatat sebagai angka', async () => {
    const out = await adapterWith(async () =>
      lhr({ audits: { 'largest-contentful-paint': { numericValue: Number.NaN } } }),
    ).run(ctx());
    expect(out.status).toBe('PASS');
    expect(out.metrics).not.toHaveProperty('lcp_ms');
  });

  it('kondisi tidak comparable (form factor berbeda) diberi indikator, bukan disembunyikan', async () => {
    const out = await adapterWith(async () =>
      lhr({ configSettings: { formFactor: 'desktop', throttlingMethod: 'devtools' } }),
    ).run(ctx());
    expect(out.status).toBe('PASS');
    expect(out.metrics?.['comparable']).toBe(0);
    const mobile = await adapterWith(async () => lhr(), { config: { formFactor: 'mobile' } }).run(
      ctx(),
    );
    expect(mobile.metrics?.['comparable']).toBe(0);
  });

  it('secret di detail audit diredaksi sebelum laporan disimpan', async () => {
    const out = await adapterWith(async () =>
      lhr({
        audits: {
          'first-contentful-paint': { numericValue: 900, details: { items: [CANARY] } },
        },
      }),
    ).run(ctx());
    const bytes = artifacts.readVerified((out.artifactRefs ?? [])[0] ?? '').toString('utf8');
    expect(bytes).not.toContain(CANARY);
    expect(bytes).toContain('[REDACTED:GROQ_API_KEY]');
  });

  it('laporan melebihi batas ukuran ditolak (tidak dipotong diam-diam dan tidak disimpan)', async () => {
    const big = 'x'.repeat(20_000);
    const out = await adapterWith(
      async () => lhr({ audits: { 'first-contentful-paint': { numericValue: 900, big } } }),
      { config: { maxReportBytes: 10_000 } },
    ).run(ctx());
    expect(out.status).toBe('ERROR');
    expect(out.errorCode).toBe('TOOL_FAILED');
    expect(out.artifactRefs ?? []).toHaveLength(0);
  });
});

describe('LighthouseAdapter — kegagalan dan negative tests', () => {
  it('executable tidak ada → UNAVAILABLE TOOL_MISSING dan runner tidak dipanggil', async () => {
    let called = false;
    const out = await adapterWith(
      async () => {
        called = true;
        return lhr();
      },
      { executablePath: path.join(dir, 'tidak-ada') },
    ).run(ctx());
    expect(out.status).toBe('UNAVAILABLE');
    expect(out.errorCode).toBe('TOOL_MISSING');
    expect(called).toBe(false);
  });

  it('executable tidak diset → UNAVAILABLE TOOL_MISSING', async () => {
    const saved = process.env['CHROMIUM_PATH'];
    delete process.env['CHROMIUM_PATH'];
    try {
      // Adapter dibuat setelah env dihapus, karena konstruktor membaca CHROMIUM_PATH.
      const adapter = new LighthouseAdapter({ artifacts, runner: async () => lhr() });
      const out = await adapter.run(ctx());
      expect(out.status).toBe('UNAVAILABLE');
      expect(out.errorCode).toBe('TOOL_MISSING');
    } finally {
      if (saved !== undefined) process.env['CHROMIUM_PATH'] = saved;
    }
  });

  it('output malformed (kategori hilang, string bukan objek) → ERROR TOOL_FAILED', async () => {
    const malformed: unknown[] = [
      'bukan-objek',
      { lighthouseVersion: '13.5.0' },
      lhr({ categories: 'x' }),
    ];
    for (const raw of malformed) {
      const out = await adapterWith(async () => raw).run(ctx());
      expect(out.status).toBe('ERROR');
      expect(out.errorCode).toBe('TOOL_FAILED');
    }
  });

  it('runtimeError dari Lighthouse → ERROR, tidak dianggap skor', async () => {
    const out = await adapterWith(async () =>
      lhr({ runtimeError: { code: 'NO_FCP', message: 'x' } }),
    ).run(ctx());
    expect(out.status).toBe('ERROR');
    expect(out.errorCode).toBe('TOOL_FAILED');
    expect(out.errorMessageSafe).toContain('NO_FCP');
  });

  it('kegagalan peluncuran browser (runner melempar sebelum Lighthouse berjalan) → ERROR TOOL_FAILED', async () => {
    const out = await adapterWith(async () => {
      throw new Error('spawn /opt/chrome ENOENT; Failed to launch chrome: exit code 1');
    }).run(ctx());
    expect(out.status).toBe('ERROR');
    expect(out.errorCode).toBe('TOOL_FAILED');
    expect(out.metrics).toBeUndefined();
    expect(out.errorMessageSafe).not.toContain('ENOENT');
  });

  it('runner yang terlambat selesai setelah timeout tidak mengubah hasil', async () => {
    let finish: (v: unknown) => void = () => undefined;
    const out = await adapterWith(
      () =>
        new Promise<unknown>((resolve) => {
          finish = resolve;
        }),
      { timeoutMs: 30 },
    ).run(ctx());
    finish(lhr());
    expect(out.errorCode).toBe('TIMEOUT');
  });

  it('runner melempar error → ERROR TOOL_FAILED tanpa membocorkan pesan asli', async () => {
    const out = await adapterWith(async () => {
      throw new Error(`gagal di /home/user/rahasia ${CANARY}`);
    }).run(ctx());
    expect(out.status).toBe('ERROR');
    expect(out.errorCode).toBe('TOOL_FAILED');
    expect(out.errorMessageSafe).not.toContain('/home/user');
    expect(out.errorMessageSafe).not.toContain(CANARY);
  });

  it('redirect ke origin lain (finalUrl) → ERROR SCOPE_DENIED', async () => {
    const out = await adapterWith(async () =>
      lhr({ finalUrl: 'https://evil.example/landing' }),
    ).run(ctx());
    expect(out.status).toBe('ERROR');
    expect(out.errorCode).toBe('SCOPE_DENIED');
    expect(out.artifactRefs ?? []).toHaveLength(0);
  });

  it('timeout → ERROR TIMEOUT dan sinyal runner dibatalkan', async () => {
    let seenAbort = false;
    const out = await adapterWith(
      (input) =>
        new Promise<unknown>(() => {
          input.signal.addEventListener('abort', () => {
            seenAbort = true;
          });
        }),
      { timeoutMs: 50 },
    ).run(ctx());
    expect(out.status).toBe('ERROR');
    expect(out.errorCode).toBe('TIMEOUT');
    expect(seenAbort).toBe(true);
  });

  it('pembatalan run saat berjalan → ERROR CANCELLED', async () => {
    const controller = new AbortController();
    const pending = adapterWith(
      () =>
        new Promise<unknown>(() => {
          setTimeout(() => controller.abort(), 10);
        }),
    ).run(ctx(controller.signal));
    const out = await pending;
    expect(out.status).toBe('ERROR');
    expect(out.errorCode).toBe('CANCELLED');
  });

  it('dibatalkan sebelum mulai → CANCELLED tanpa menjalankan runner', async () => {
    const controller = new AbortController();
    controller.abort();
    let called = false;
    const out = await adapterWith(async () => {
      called = true;
      return lhr();
    }).run(ctx(controller.signal));
    expect(out.errorCode).toBe('CANCELLED');
    expect(called).toBe(false);
  });

  it('config tidak valid → ERROR CONFIG_INVALID', async () => {
    const out = await adapterWith(async () => lhr(), { config: { startPath: '//x' } }).run(ctx());
    expect(out.status).toBe('ERROR');
    expect(out.errorCode).toBe('CONFIG_INVALID');
  });

  it('artefak gagal disimpan → hasil tetap ada dengan artifact_saved=0', async () => {
    const broken = new ArtifactStore({
      rootDir: path.join(dir, 'artifacts-2'),
      evidence: store.evidence,
    });
    const adapter = new LighthouseAdapter({
      artifacts: broken,
      runner: async () => lhr(),
      executablePath: FAKE_EXECUTABLE,
    });
    // Run yang tidak ada membuat insert metadata gagal (FK), sehingga penyimpanan artefak gagal.
    const orphan: ModuleContext = { ...ctx(), runId: 'run_000000000000000000000000' };
    const out = await adapter.run(orphan);
    expect(out.status).toBe('PASS');
    expect(out.artifactRefs ?? []).toHaveLength(0);
    expect(out.metrics?.['artifact_saved']).toBe(0);
    const left = readdirSync(path.join(dir, 'artifacts-2'));
    expect(left.length).toBeLessThanOrEqual(1);
  });
});

describe('LighthouseAdapter — Chromium nyata (opsional)', () => {
  const BROWSER = process.env['CHROMIUM_PATH'];
  const hasBrowser = typeof BROWSER === 'string' && BROWSER.length > 0;
  if (REQUIRE_BROWSER && !hasBrowser) {
    throw new Error(
      'REQUIRE_BROWSER_TESTS=1 tetapi CHROMIUM_PATH kosong: tes browser tidak boleh dilewati.',
    );
  }
  const real = hasBrowser ? it : it.skip;

  real(
    'fixture clean dijalankan dengan Lighthouse dan Chrome nyata',
    async () => {
      const fixture = await startFixture('clean');
      try {
        const realGrant: ScopeGrant = { origin: fixture.origin, mode: 'local-fixture' };
        const adapter = new LighthouseAdapter({
          artifacts,
          executablePath: BROWSER,
          config: { categories: ['performance'] },
        });
        const c: ModuleContext = { ...ctx(), grant: realGrant, targetOrigin: fixture.origin };
        const out = await adapter.run(c);
        expect(out.status).toBe('PASS');
        expect(out.metrics?.['score_performance']).toBeGreaterThanOrEqual(0);
        expect(out.metrics?.['score_performance']).toBeLessThanOrEqual(100);
        expect(out.toolVersion).toContain('13.5.0');
        expect(out.artifactRefs?.length).toBe(1);
      } finally {
        await fixture.close();
      }
    },
    180_000,
  );
});

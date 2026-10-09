import { mkdtempSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRun, createTarget, type Run, type ScopeGrant } from '@nusawebbench/core';
import { readGroundTruth, startFixture } from '@nusawebbench/fixtures';
import type { ModuleContext } from '@nusawebbench/orchestrator';
import { ArtifactStore, Store } from '@nusawebbench/storage';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UxRulesAdapter, type Snapshot } from '../src/index.js';

const REQUIRE_BROWSER = process.env['REQUIRE_BROWSER_TESTS'] === '1';
const BROWSER = process.env['CHROMIUM_PATH'];
const hasBrowser = typeof BROWSER === 'string' && BROWSER.length > 0;
if (REQUIRE_BROWSER && !hasBrowser) {
  throw new Error(
    'REQUIRE_BROWSER_TESTS=1 tetapi CHROMIUM_PATH kosong: tes browser tidak boleh dilewati.',
  );
}
const real = hasBrowser ? it : it.skip;
const CANARY = `gsk_${'Q'.repeat(40)}`;

// Server loopback untuk halaman uji kecil (hanya 127.0.0.1).
type Page = { status?: number; body: string; delayMs?: number; redirectTo?: string };
let server: Server;
let base = '';
const pages = new Map<string, Page>();

beforeAll(async () => {
  server = createServer((req, res) => {
    const page = pages.get(req.url ?? '');
    if (!page) {
      res.writeHead(404, { 'content-type': 'text/html' }).end('<p>tidak ada</p>');
      return;
    }
    const send = () => {
      if (page.redirectTo) {
        res.writeHead(302, { location: page.redirectTo }).end();
        return;
      }
      res
        .writeHead(page.status ?? 200, { 'content-type': 'text/html; charset=utf-8' })
        .end(page.body);
    };
    if (page.delayMs) setTimeout(send, page.delayMs);
    else send();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let dir: string;
let store: Store;
let run: Run;
let artifacts: ArtifactStore;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nwb-ux-'));
  store = Store.open(path.join(dir, 'db.sqlite'));
  const target = createTarget({
    label: 'uji',
    origin: base,
    mode: 'fixture',
    allowedModules: [],
    scopeConfirmedAt: null,
  });
  store.targets.insert(target);
  run = createRun({
    targetId: target.id,
    targetOrigin: base,
    targetMode: 'fixture',
    authorization: {
      acknowledged: true,
      scopeSummary: 'uji',
      scopeHash: null,
      approvedAt: '2026-10-09T02:00:00.000Z',
    },
    configSnapshot: {},
  });
  store.runs.insert(run);
  artifacts = new ArtifactStore({ rootDir: path.join(dir, 'artifacts'), evidence: store.evidence });
  pages.clear();
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function ctxFor(origin: string, signal = new AbortController().signal): ModuleContext {
  const grant: ScopeGrant = { origin, mode: 'local-fixture' };
  return {
    runId: run.id,
    moduleResultId: `mod_${'b'.repeat(32)}`,
    targetOrigin: origin,
    grant,
    signal,
    progress: () => undefined,
  };
}

const FAKE_EXEC = process.execPath;

describe('UxRulesAdapter — tanpa browser (fake snapshot)', () => {
  const emptySnap = (over: Record<string, unknown> = {}): Snapshot => ({
    schema: 1,
    url: `${base}/`,
    title: 'x',
    lang: 'id',
    viewport: { width: 390, height: 844 },
    scrollWidth: 390,
    headings: [],
    images: [],
    buttons: [],
    inputs: [],
    links: [],
    overflowing: [],
    repeatedGroups: [],
    visibleText: '',
    ...over,
  });

  it('DOM kosong → PASS tanpa temuan dan artefak snapshot tersimpan', async () => {
    const adapter = new UxRulesAdapter({
      artifacts,
      executablePath: FAKE_EXEC,
      snapshotProvider: async () => emptySnap(),
    });
    const out = await adapter.run(ctxFor(base));
    expect(out.status).toBe('PASS');
    expect(out.findings).toEqual([]);
    expect(out.artifactRefs?.length).toBe(1);
    expect(out.toolName).toBe('ux-rules');
  });

  it('pelanggaran objektif → FAIL; hanya subjektif → WARN', async () => {
    const objective = new UxRulesAdapter({
      artifacts,
      executablePath: FAKE_EXEC,
      snapshotProvider: async () =>
        emptySnap({ buttons: [{ selector: 'html > body > button', name: '', visible: true }] }),
    });
    const o = await objective.run(ctxFor(base));
    expect(o.status).toBe('FAIL');
    expect(o.findings?.[0]?.verification).toBe('CONFIRMED');
    expect(o.findings?.[0]?.ruleVersion).toBe('1.0.0');

    const subjective = new UxRulesAdapter({
      artifacts,
      executablePath: FAKE_EXEC,
      snapshotProvider: async () =>
        emptySnap({
          buttons: [
            { selector: 'a', name: 'Daftar', visible: true },
            { selector: 'b', name: 'Daftar', visible: true },
          ],
        }),
    });
    const s = await subjective.run(ctxFor(base));
    expect(s.status).toBe('WARN');
    expect(s.findings?.every((f) => f.verification === 'INFORMATIONAL')).toBe(true);
  });

  it('suppression mengubah status temuan tetapi snapshot mentah tetap tersimpan', async () => {
    const adapter = new UxRulesAdapter({
      artifacts,
      executablePath: FAKE_EXEC,
      config: {
        suppressions: [
          {
            ruleId: 'ux-control-label',
            selector: 'html > body > button',
            reason: 'tombol ikon diuji',
          },
        ],
      },
      snapshotProvider: async () =>
        emptySnap({ buttons: [{ selector: 'html > body > button', name: '', visible: true }] }),
    });
    const out = await adapter.run(ctxFor(base));
    expect(out.findings?.[0]?.status).toBe('SUPPRESSED');
    expect(out.findings?.[0]?.description).toContain('ditekan: tombol ikon diuji');
    expect(out.status).toBe('PASS');
    expect(out.artifactRefs?.length).toBe(1);
    const raw = artifacts.readVerified(out.artifactRefs?.[0] ?? '').toString('utf8');
    expect(raw).toContain('html > body > button');
  });

  it('snapshot provider mengembalikan data rusak → ERROR TOOL_FAILED', async () => {
    const adapter = new UxRulesAdapter({
      artifacts,
      executablePath: FAKE_EXEC,
      snapshotProvider: async () => ({ schema: 1, buttons: 'bukan-array' }),
    });
    const out = await adapter.run(ctxFor(base));
    expect(out.status).toBe('ERROR');
    expect(out.errorCode).toBe('TOOL_FAILED');
  });

  it('executable tidak ada → UNAVAILABLE TOOL_MISSING', async () => {
    const adapter = new UxRulesAdapter({ artifacts, executablePath: path.join(dir, 'tidak-ada') });
    const out = await adapter.run(ctxFor(base));
    expect(out.status).toBe('UNAVAILABLE');
    expect(out.errorCode).toBe('TOOL_MISSING');
  });

  it('startPath di luar scope/protokol-relative ditolak sebelum browser dibuka', async () => {
    const adapter = new UxRulesAdapter({
      artifacts,
      executablePath: FAKE_EXEC,
      config: { startPath: '//evil.example/' },
    });
    const out = await adapter.run(ctxFor(base));
    expect(out.errorCode).toBe('CONFIG_INVALID');
  });

  it('secret di teks halaman diredaksi di artefak', async () => {
    const adapter = new UxRulesAdapter({
      artifacts,
      executablePath: FAKE_EXEC,
      snapshotProvider: async () => emptySnap({ visibleText: `kunci ${CANARY}` }),
    });
    const out = await adapter.run(ctxFor(base));
    const raw = artifacts.readVerified(out.artifactRefs?.[0] ?? '').toString('utf8');
    expect(raw).not.toContain(CANARY);
  });
});

describe('UxRulesAdapter — Chromium nyata', () => {
  let fixtureGroundTruth: {
    id: string;
    expectedFindings: { module: string; ruleId?: string }[];
  }[] = [];
  beforeAll(() => {
    if (!hasBrowser) return;
    const gt = readGroundTruth() as { fixtures: typeof fixtureGroundTruth };
    fixtureGroundTruth = gt.fixtures;
  });

  async function runOnFixture(name: string, config: unknown = {}) {
    const fx = await startFixture(name as Parameters<typeof startFixture>[0]);
    try {
      const adapter = new UxRulesAdapter({ artifacts, executablePath: BROWSER, config });
      return await adapter.run(ctxFor(fx.origin));
    } finally {
      await fx.close();
    }
  }

  const ruleIdsOf = (out: { findings?: readonly { ruleId: string | null }[] }) =>
    (out.findings ?? []).map((f) => f.ruleId ?? '').sort();

  real(
    'fixture clean tidak menghasilkan temuan objektif',
    async () => {
      const out = await runOnFixture('clean');
      expect(out.status).toBe('PASS');
      expect(ruleIdsOf(out)).toEqual([]);
    },
    120_000,
  );

  real(
    'ground truth UX_RULES: a11y-defects, ux-signals, broken-resources sesuai daftar yang diharapkan',
    async () => {
      for (const name of ['a11y-defects', 'ux-signals', 'broken-resources']) {
        const out = await runOnFixture(name);
        const expected = fixtureGroundTruth
          .find((f) => f.id === name)
          ?.expectedFindings.filter((f) => f.module === 'UX_RULES')
          .map((f) => f.ruleId ?? '')
          .sort();
        expect(ruleIdsOf(out), name).toEqual(expected);
      }
    },
    180_000,
  );

  real(
    'determinisme: dua run pada fixture yang sama menghasilkan temuan identik',
    async () => {
      const a = await runOnFixture('ux-signals');
      const b = await runOnFixture('ux-signals');
      const key = (out: typeof a) =>
        (out.findings ?? []).map((f) => `${f.ruleId}|${f.selector}|${f.description}`).sort();
      expect(key(a)).toEqual(key(b));
    },
    120_000,
  );

  real(
    'viewport responsif: overflow hanya pada viewport kecil',
    async () => {
      const small = await runOnFixture('ux-signals', { viewport: { width: 390, height: 844 } });
      const large = await runOnFixture('ux-signals', { viewport: { width: 1440, height: 900 } });
      expect(ruleIdsOf(small)).toContain('ux-horizontal-overflow');
      expect(ruleIdsOf(large)).not.toContain('ux-horizontal-overflow');
      expect(large.metrics?.['viewportWidth']).toBe(1440);
    },
    120_000,
  );

  real(
    'DOM dinamis yang muncul sebelum load ikut terperiksa',
    async () => {
      pages.set('/dyn', {
        body: '<!doctype html><html lang="id"><head><title>Dinamis</title></head><body><main><h1>Judul</h1><script>document.addEventListener("DOMContentLoaded",()=>{const i=document.createElement("img");i.src="/x.png";document.body.appendChild(i);});</script></main></body></html>',
      });
      const out = await new UxRulesAdapter({ artifacts, executablePath: BROWSER })
        .run({ ...ctxFor(base), grant: { origin: base, mode: 'local-fixture' } })
        .then(async () => {
          return new UxRulesAdapter({
            artifacts,
            executablePath: BROWSER,
            config: { startPath: '/dyn' },
          }).run(ctxFor(base));
        });
      expect(ruleIdsOf(out)).toContain('ux-img-alt');
    },
    120_000,
  );

  real(
    'batasan: DOM yang disisipkan setelah load tidak terperiksa dan shadow DOM/iframe tidak ditelusuri',
    async () => {
      pages.set('/late', {
        body: '<!doctype html><html lang="id"><head><title>Terlambat</title></head><body><main><h1>Judul</h1><script>setTimeout(()=>{const b=document.createElement("button");document.body.appendChild(b);},2500);</script></main></body></html>',
      });
      pages.set('/shadow', {
        body: '<!doctype html><html lang="id"><head><title>Shadow</title></head><body><main><h1>Judul</h1><div id="h"></div><script>const r=document.getElementById("h").attachShadow({mode:"open"});r.innerHTML="<button></button>";</script><iframe src="/frame"></iframe></main></body></html>',
      });
      pages.set('/frame', { body: '<!doctype html><html><body><button></button></body></html>' });
      const late = await new UxRulesAdapter({
        artifacts,
        executablePath: BROWSER,
        config: { startPath: '/late' },
      }).run(ctxFor(base));
      expect(ruleIdsOf(late)).not.toContain('ux-control-label');
      const shadow = await new UxRulesAdapter({
        artifacts,
        executablePath: BROWSER,
        config: { startPath: '/shadow' },
      }).run(ctxFor(base));
      expect(ruleIdsOf(shadow)).not.toContain('ux-control-label');
    },
    120_000,
  );

  real(
    'halaman kosong dan CSS yang hilang tidak menggagalkan pemeriksaan',
    async () => {
      pages.set('/empty', {
        body: '<!doctype html><html lang="id"><head><title>K</title><link rel="stylesheet" href="/none.css"></head><body></body></html>',
      });
      const out = await new UxRulesAdapter({
        artifacts,
        executablePath: BROWSER,
        config: { startPath: '/empty' },
      }).run(ctxFor(base));
      expect(out.status).toBe('PASS');
    },
    120_000,
  );

  real(
    'selector ambigu: dua tombol tanpa label mendapat selector berbeda',
    async () => {
      pages.set('/twin', {
        body: '<!doctype html><html lang="id"><head><title>Dua</title></head><body><main><h1>Judul</h1><button></button><button></button></main></body></html>',
      });
      const out = await new UxRulesAdapter({
        artifacts,
        executablePath: BROWSER,
        config: { startPath: '/twin' },
      }).run(ctxFor(base));
      const selectors = (out.findings ?? [])
        .filter((f) => f.ruleId === 'ux-control-label')
        .map((f) => f.selector);
      expect(selectors).toHaveLength(2);
      expect(new Set(selectors).size).toBe(2);
    },
    120_000,
  );

  real(
    'timeout halaman → ERROR TIMEOUT bertanda retryable',
    async () => {
      pages.set('/slow', { body: '<html></html>', delayMs: 20_000 });
      const adapter = new UxRulesAdapter({
        artifacts,
        executablePath: BROWSER,
        config: { startPath: '/slow' },
        timeoutMs: 1_500,
      });
      const out = await adapter.run(ctxFor(base));
      expect(out.status).toBe('ERROR');
      expect(out.errorCode).toBe('TIMEOUT');
      expect(out.retryable).toBe(true);
    },
    120_000,
  );

  real(
    'redirect ke origin luar diblokir oleh guard → ERROR, tidak mengikuti',
    async () => {
      pages.set('/to-ext', { body: '', redirectTo: 'http://nwb-external.invalid/' });
      const out = await new UxRulesAdapter({
        artifacts,
        executablePath: BROWSER,
        config: { startPath: '/to-ext' },
      }).run(ctxFor(base));
      expect(out.status).toBe('ERROR');
      expect(out.findings ?? []).toEqual([]);
    },
    120_000,
  );

  real(
    'pembatalan saat berjalan → ERROR CANCELLED',
    async () => {
      pages.set('/cancel', { body: '<html></html>', delayMs: 20_000 });
      const controller = new AbortController();
      setTimeout(() => controller.abort(), 800);
      const out = await new UxRulesAdapter({
        artifacts,
        executablePath: BROWSER,
        config: { startPath: '/cancel' },
      }).run(ctxFor(base, controller.signal));
      expect(out.status).toBe('ERROR');
      expect(out.errorCode).toBe('CANCELLED');
    },
    120_000,
  );

  it('peluncuran browser gagal → UNAVAILABLE (tanpa menjalankan browser nyata)', async () => {
    const adapter = new UxRulesAdapter({
      artifacts,
      executablePath: FAKE_EXEC,
      launch: async () => {
        throw new Error('Failed to launch chrome: exit 1');
      },
    });
    const out = await adapter.run(ctxFor(base));
    expect(out.status).toBe('UNAVAILABLE');
    expect(out.skippedReason).toBe('browser-launch-failed');
  });
});

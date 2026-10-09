import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTarget, type ScopeGrant, type Target } from '@nusawebbench/core';
import { RunOrchestrator, type ModuleContext } from '@nusawebbench/orchestrator';
import { ArtifactStore, Store } from '@nusawebbench/storage';
import { readGroundTruth, startFixture, type FixtureServer } from '@nusawebbench/fixtures';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FUNCTIONAL_QA_RULES,
  FUNCTIONAL_QA_TOOL_VERSION,
  FunctionalQaAdapter,
} from '../src/index.js';

/**
 * Tes browser memakai Chromium nyata dan hanya berjalan bila `CHROMIUM_PATH` diset.
 * Tanpa variabel ini, blok tersebut dilewati (SKIPPED), dan TIDAK dihitung sebagai bukti.
 */
const BROWSER_PATH = process.env['CHROMIUM_PATH'];
const hasBrowser = typeof BROWSER_PATH === 'string' && BROWSER_PATH.length > 0;
/** Satu run browser (beberapa halaman + tautan + alur) bisa melewati batas default 10 detik. */
const INTEGRATION_TIMEOUT_MS = 90_000;

// ---------- Tes tanpa browser (selalu berjalan) ----------

describe('FunctionalQaAdapter tanpa browser', () => {
  let dir: string;
  let store: Store;
  let artifacts: ArtifactStore;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'nwb-qa-'));
    store = Store.open(path.join(dir, 'test.sqlite'));
    artifacts = new ArtifactStore({
      rootDir: path.join(dir, 'artifacts'),
      evidence: store.evidence,
    });
  });

  afterEach(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function ctxFor(signal: AbortSignal): ModuleContext {
    return {
      runId: 'run_00000000000000000000000000000000',
      moduleResultId: 'module_00000000000000000000000000000000',
      targetOrigin: 'http://127.0.0.1:1',
      grant: { origin: 'http://127.0.0.1:1', mode: 'local-fixture' },
      signal,
      progress: () => undefined,
    };
  }

  it('konfigurasi tidak valid menghasilkan ERROR CONFIG_INVALID tanpa membuka browser', async () => {
    const adapter = new FunctionalQaAdapter({ artifacts, config: { maxPages: 999 } });
    const out = await adapter.run(ctxFor(new AbortController().signal));
    expect(out.status).toBe('ERROR');
    expect(out.errorCode).toBe('CONFIG_INVALID');
  });

  it('executable yang tidak ada menghasilkan UNAVAILABLE TOOL_MISSING (bukan PASS)', async () => {
    const adapter = new FunctionalQaAdapter({
      artifacts,
      executablePath: path.join(dir, 'tidak-ada', 'chromium'),
    });
    const out = await adapter.run(ctxFor(new AbortController().signal));
    expect(out.status).toBe('UNAVAILABLE');
    expect(out.errorCode).toBe('TOOL_MISSING');
    expect(out.findings ?? []).toEqual([]);
  });

  it('versi tool yang dicatat sama dengan versi paket playwright-core yang terpasang', async () => {
    const pkg = (await import('playwright-core/package.json', { with: { type: 'json' } }))
      .default as {
      version: string;
    };
    expect(pkg.version).toBe(FUNCTIONAL_QA_TOOL_VERSION);
  });

  it('setiap aturan memiliki id yang valid dan severity yang dikenal', () => {
    for (const [id, rule] of Object.entries(FUNCTIONAL_QA_RULES)) {
      expect(id).toMatch(/^[a-z][a-z0-9-]{2,63}$/);
      expect(rule.category).toBe('FUNCTIONAL');
      expect(['HIGH', 'MEDIUM', 'LOW', 'CRITICAL', 'INFO', 'UNKNOWN']).toContain(rule.severity);
    }
  });
});

// ---------- Tes integrasi dengan Chromium nyata (opsional) ----------

describe.skipIf(!hasBrowser)('FunctionalQaAdapter dengan Chromium nyata (fixture lokal)', () => {
  let dir: string;
  let store: Store;
  let artifacts: ArtifactStore;
  let server: FixtureServer | undefined;
  let target: Target;
  let grant: ScopeGrant;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'nwb-qa-int-'));
    store = Store.open(path.join(dir, 'test.sqlite'));
    artifacts = new ArtifactStore({
      rootDir: path.join(dir, 'artifacts'),
      evidence: store.evidence,
    });
  }, INTEGRATION_TIMEOUT_MS);

  afterEach(async () => {
    await server?.close();
    server = undefined;
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }, INTEGRATION_TIMEOUT_MS);

  async function runFixture(name: string, config: unknown) {
    server = await startFixture(name, { port: 0 });
    grant = { origin: server.origin, mode: 'local-fixture' };
    target = createTarget({
      label: `fixture ${name}`,
      origin: server.origin,
      mode: 'fixture',
      allowedModules: [],
      scopeConfirmedAt: null,
    });
    store.targets.insert(target);
    const adapter = new FunctionalQaAdapter({ artifacts, config, executablePath: BROWSER_PATH });
    const orch = new RunOrchestrator({ store, adapters: [adapter] });
    const run = orch.createRun({ target, grant, modules: ['FUNCTIONAL_QA'], acknowledged: true });
    const done = await orch.start(run.id);
    const modules = store.modules.listByRun(run.id);
    const findings = store.findings.listByRun(run.id, { limit: 500 }).items;
    return { run: done, modules, findings, evidence: store.evidence.listByRun(run.id) };
  }

  it(
    'fixture clean tidak menghasilkan temuan objektif (PASS)',
    async () => {
      const { modules, findings, evidence } = await runFixture('clean', {
        startPath: '/index.html',
        maxDepth: 1,
        maxPages: 5,
      });
      const mod = modules.find((m) => m.module === 'FUNCTIONAL_QA');
      expect(mod?.status).toBe('PASS');
      expect(findings).toEqual([]);
      expect(mod?.metrics['pagesVisited']).toBeGreaterThan(0);
      expect(evidence.every((e) => e.kind === 'screenshot' && e.synthetic)).toBe(true);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    'fixture functional-defects: mendeteksi FD-01..FD-04 sesuai ground truth',
    async () => {
      const truth = readGroundTruth() as {
        fixtures: { id: string; expectedFindings: { id: string; kind: string }[] }[];
      };
      const expected =
        truth.fixtures.find((f) => f.id === 'functional-defects')?.expectedFindings ?? [];
      expect(expected.map((e) => e.id)).toEqual(['FD-01', 'FD-02', 'FD-03', 'FD-04']);

      const { modules, findings } = await runFixture('functional-defects', {
        startPath: '/index.html',
        maxDepth: 1,
        flows: [
          {
            name: 'muat-data',
            steps: [
              { action: 'click', selector: '#load-btn' },
              { action: 'expectText', selector: '#status', text: 'Status 404' },
            ],
          },
        ],
      });
      expect(modules.find((m) => m.module === 'FUNCTIONAL_QA')?.status).toBe('FAIL');

      const ruleIds = new Set(findings.map((f) => f.ruleId));
      expect(ruleIds.has('qa-page-error')).toBe(true); // FD-01
      expect(ruleIds.has('qa-console-error')).toBe(true); // FD-02
      expect(ruleIds.has('qa-broken-link')).toBe(true); // FD-03
      // FD-04: hanya terjadi setelah klik #load-btn; harus berasal dari alur, bukan crawl.
      expect(
        findings.some(
          (f) =>
            f.ruleId === 'qa-http-error-response' &&
            f.description.includes('/api/missing-resource'),
        ),
      ).toBe(true);

      for (const f of findings) {
        expect(f.source).toBe('DETERMINISTIC');
        expect(f.category).toBe('FUNCTIONAL');
        expect(f.evidenceRefs.length).toBeGreaterThan(0);
        expect(f.verification).toBe('CONFIRMED');
        expect(f.title.length).toBeGreaterThan(0);
      }
      expect(
        findings
          .filter((f) => f.ruleId === 'qa-broken-link')
          .some((f) => f.description.includes('/broken-link.html')),
      ).toBe(true);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    'halaman dengan selector yang tidak ada menghasilkan temuan asersi, bukan crash',
    async () => {
      const { findings } = await runFixture('clean', {
        startPath: '/index.html',
        maxDepth: 0,
        flows: [{ name: 'cek', steps: [{ action: 'expectVisible', selector: '#tidak-ada' }] }],
      });
      expect(findings.some((f) => f.ruleId === 'qa-flow-assertion')).toBe(true);
    },
    INTEGRATION_TIMEOUT_MS,
  );

  it(
    'klik pada tombol berisiko ditolak dan modul ERROR VALIDATION_FAILED',
    async () => {
      server = await startFixture('clean', { port: 0 });
      grant = { origin: server.origin, mode: 'local-fixture' };
      target = createTarget({
        label: 'fixture clean',
        origin: server.origin,
        mode: 'fixture',
        allowedModules: [],
        scopeConfirmedAt: null,
      });
      store.targets.insert(target);
      const adapter = new FunctionalQaAdapter({
        artifacts,
        executablePath: BROWSER_PATH,
        config: {
          startPath: '/index.html',
          maxDepth: 0,
          flows: [
            { name: 'bayar', steps: [{ action: 'click', selector: 'button:has-text("Bayar")' }] },
          ],
        },
      });
      const orch = new RunOrchestrator({ store, adapters: [adapter] });
      const run = orch.createRun({ target, grant, modules: ['FUNCTIONAL_QA'], acknowledged: true });
      await orch.start(run.id);
      const mod = store.modules.listByRun(run.id).find((m) => m.module === 'FUNCTIONAL_QA');
      // Selector memuat kata "Bayar", sehingga langkah ditolak sebelum klik dilakukan (tidak ada FAIL).
      expect(mod?.status).toBe('ERROR');
      expect(mod?.errorCode).toBe('VALIDATION_FAILED');
    },
    INTEGRATION_TIMEOUT_MS,
  );
});

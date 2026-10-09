import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import {
  AppError,
  MODULE_NAMES,
  createScopeGrant,
  createTarget,
  type ModuleName,
  type Target,
} from '@nusawebbench/core';
import { buildRunPlan, type RunOrchestrator } from '@nusawebbench/orchestrator';
import { buildReport, saveReport } from '@nusawebbench/report';
import type { ArtifactStore, Store } from '@nusawebbench/storage';
import { parseSettingsUpdate, type AiService, type AiSettingsService } from '@nusawebbench/ai';
import { APP_CSS, APP_JS, INDEX_HTML } from './pages.js';
import {
  HttpError,
  checkHostAndOrigin,
  readJson,
  sendError,
  sendJson,
  sendStatic,
  SECURITY_HEADERS,
} from './http.js';
import { StartTracker } from './start-tracker.js';

export const MODULE_LABELS: Readonly<Partial<Record<ModuleName, string>>> = Object.freeze({
  FUNCTIONAL_QA: 'QA fungsional (Chromium)',
  UX_RULES: 'UX dan aksesibilitas (deterministik)',
  LIGHTHOUSE: 'Lighthouse (performa dan aksesibilitas)',
});

/** Modul yang punya adapter di dashboard MVP. LOAD_K6, SECURITY_STRIX, AI_* belum disambungkan. */
export const WEB_MODULES: readonly ModuleName[] = Object.freeze([
  'FUNCTIONAL_QA',
  'UX_RULES',
  'LIGHTHOUSE',
]);

const ID = /^[a-z]+_[a-f0-9]{32}$/;
const TERMINAL = new Set(['COMPLETED', 'PARTIAL', 'FAILED', 'CANCELLED']);

const CreateTargetSchema = z.strictObject({
  label: z.string().trim().min(1).max(100),
  origin: z.string().min(1).max(2048),
  mode: z.enum(['fixture', 'url']),
});

const RunRequestSchema = z.strictObject({
  targetId: z.string().min(1).max(80),
  modules: z.array(z.enum(MODULE_NAMES)).min(1).max(3),
  acknowledged: z.literal(true),
});

const PlanRequestSchema = z.strictObject({
  targetId: z.string().min(1).max(80),
  modules: z.array(z.enum(MODULE_NAMES)).min(1).max(3),
});

const ProviderTestSchema = z.strictObject({ confirm: z.literal(true) });

export type WebDeps = {
  readonly store: Store;
  readonly artifacts: ArtifactStore;
  readonly orchestrator: RunOrchestrator;
  readonly aiSettings: AiSettingsService;
  readonly aiService: AiService;
  readonly allowedHosts: readonly string[];
  readonly now?: () => Date;
  /** Diagnostik lokal (disk, DB, tool). Tidak ada telemetri jarak jauh. */
  readonly diagnose?: () => Promise<Record<string, unknown>>;
};

function parseBody<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Data permintaan tidak valid.');
  }
  return parsed.data;
}

/** Origin target: http(s), tanpa kredensial/path/query/hash; mode fixture hanya loopback. */
export function parseTargetOrigin(raw: string, mode: 'fixture' | 'url'): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Origin tidak valid.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Protokol harus http atau https.');
  }
  if (url.username !== '' || url.password !== '') {
    throw new HttpError(400, 'VALIDATION_FAILED', 'Origin tidak boleh memuat kredensial.');
  }
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') {
    throw new HttpError(
      400,
      'VALIDATION_FAILED',
      'Masukkan origin saja, tanpa path, query, atau fragmen.',
    );
  }
  const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
  if (mode === 'fixture' && !loopback) {
    throw new HttpError(
      400,
      'VALIDATION_FAILED',
      'Mode fixture hanya untuk loopback (127.0.0.1 atau localhost).',
    );
  }
  return url.origin;
}

function targetJson(t: Target) {
  return {
    id: t.id,
    label: t.label,
    origin: t.origin,
    mode: t.mode,
    createdAt: t.createdAt,
  };
}

function toHttpError(err: unknown): HttpError {
  if (err instanceof HttpError) return err;
  if (err instanceof AppError) {
    const map: Record<string, [number, string]> = {
      NOT_FOUND: [404, 'NOT_FOUND'],
      VALIDATION_FAILED: [400, 'VALIDATION_FAILED'],
      CONFLICT: [409, 'CONFLICT'],
      CONSENT_REQUIRED: [422, 'CONSENT_REQUIRED'],
      SCOPE_DENIED: [422, 'SCOPE_DENIED'],
      PAYLOAD_TOO_LARGE: [413, 'PAYLOAD_TOO_LARGE'],
    };
    const hit = map[err.code];
    if (hit)
      return new HttpError(hit[0], hit[1], err.safeMessage || 'Permintaan tidak dapat diproses.');
  }
  return new HttpError(500, 'INTERNAL', 'Terjadi kesalahan di server.');
}

export function createApp(deps: WebDeps) {
  const now = deps.now ?? (() => new Date());
  /** Start yang masih tertunda. Mencegah start ganda dari retry/double-submit (F-11: entri dibersihkan). */
  const starts = new StartTracker();

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    const url = new URL(req.url ?? '/', 'http://localhost');
    const path = url.pathname;

    const hostErr = checkHostAndOrigin(req, deps.allowedHosts, method);
    if (hostErr) {
      sendError(res, hostErr);
      return;
    }

    // Halaman statis (tanpa data).
    if (method === 'GET' || method === 'HEAD') {
      if (path === '/') return void sendStatic(res, 'text/html; charset=utf-8', INDEX_HTML);
      if (path === '/app.js') return void sendStatic(res, 'text/javascript; charset=utf-8', APP_JS);
      if (path === '/app.css') return void sendStatic(res, 'text/css; charset=utf-8', APP_CSS);
      // Chrome meminta favicon otomatis; tanpa ikon, respons 404 tercatat sebagai error konsol.
      if (path === '/favicon.ico') {
        res.writeHead(204, SECURITY_HEADERS);
        res.end();
        return;
      }
    }

    let route: Route | null;
    try {
      route = matchRoute(method, path);
    } catch (err) {
      return sendError(res, toHttpError(err));
    }
    if (!route) {
      const pathExists = routes.some((r) => r.pattern.test(path));
      if (pathExists)
        return sendError(res, new HttpError(405, 'METHOD_NOT_ALLOWED', 'Metode tidak diizinkan.'));
      return sendError(res, new HttpError(404, 'NOT_FOUND', 'Rute tidak ditemukan.'));
    }

    try {
      const body = route.hasBody ? await readJson(req) : undefined;
      const result = await route.run(route.params, body, url.searchParams, req);
      if (result.kind === 'json') {
        sendJson(res, result.status, result.body);
        return;
      }
      if (result.kind === 'file') {
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-disposition': `attachment; filename="${result.filename}"`,
          'content-length': result.data.length.toString(),
          'x-content-type-options': 'nosniff',
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; sandbox",
        });
        res.end(result.data);
        return;
      }
    } catch (err) {
      sendError(res, toHttpError(err));
      return;
    }
    return undefined;
  }

  type Result =
    | { kind: 'json'; status: number; body: unknown }
    | { kind: 'file'; filename: string; data: Buffer };

  type Route = {
    hasBody: boolean;
    params: Record<string, string>;
    run: (
      p: Record<string, string>,
      body: unknown,
      q: URLSearchParams,
      req: IncomingMessage,
    ) => Result | Promise<Result>;
  };

  function getRun(id: string) {
    if (!ID.test(id)) throw new HttpError(400, 'VALIDATION_FAILED', 'ID tidak valid.');
    const run = deps.store.runs.get(id);
    if (!run) throw new HttpError(404, 'NOT_FOUND', 'Run tidak ditemukan.');
    return run;
  }

  function getTarget(id: string): Target {
    const t = deps.store.targets.get(id);
    if (!t) throw new HttpError(404, 'NOT_FOUND', 'Target tidak ditemukan.');
    return t;
  }

  const routes: Array<{ method: string; pattern: RegExp; keys: string[]; route: Route }> = [];
  function add(method: string, pattern: string, hasBody: boolean, run: Route['run']) {
    const keys: string[] = [];
    const re = new RegExp(
      '^' +
        pattern.replace(/:([a-zA-Z]+)/g, (_m, k: string) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '$',
    );
    routes.push({ method, pattern: re, keys, route: { hasBody, params: {}, run } });
  }

  add('GET', '/api/health', false, () => ({ kind: 'json', status: 200, body: { ok: true } }));

  add('GET', '/api/diagnostics', false, async () => ({
    kind: 'json',
    status: 200,
    body: deps.diagnose ? await deps.diagnose() : { note: 'diagnostik tidak dikonfigurasi' },
  }));

  add('GET', '/api/modules', false, () => ({
    kind: 'json',
    status: 200,
    body: { modules: WEB_MODULES.map((m) => ({ name: m, label: MODULE_LABELS[m] ?? m })) },
  }));

  add('GET', '/api/targets', false, () => ({
    kind: 'json',
    status: 200,
    body: { items: deps.store.targets.list(100).map(targetJson) },
  }));

  add('POST', '/api/targets', true, (_p, body) => {
    const input = parseBody(CreateTargetSchema, body);
    const origin = parseTargetOrigin(input.origin, input.mode);
    if (deps.store.targets.findByOrigin(origin)) {
      throw new HttpError(409, 'CONFLICT', 'Target dengan origin ini sudah ada.');
    }
    const target = createTarget({
      label: input.label,
      origin,
      mode: input.mode,
      allowedModules: [],
      scopeConfirmedAt: null,
      now: now(),
    });
    deps.store.targets.insert(target);
    return { kind: 'json', status: 201, body: targetJson(target) };
  });

  add('POST', '/api/plan', true, (_p, body) => {
    const input = parseBody(PlanRequestSchema, body);
    const target = getTarget(input.targetId);
    const plan = buildRunPlan({
      origin: target.origin,
      mode: target.mode === 'fixture' ? 'local-fixture' : 'remote',
      modules: input.modules.filter((m) => WEB_MODULES.includes(m)),
    });
    const unsupported = input.modules.filter((m) => !WEB_MODULES.includes(m));
    return {
      kind: 'json',
      status: 200,
      body: {
        ...plan,
        unsupportedModules: unsupported,
        note: unsupported.length > 0 ? 'Modul tersebut belum tersedia di dashboard MVP.' : null,
      },
    };
  });

  add('POST', '/api/runs', true, (_p, body, _q, req) => {
    const input = parseBody(RunRequestSchema, body);
    const unsupported = input.modules.filter((m) => !WEB_MODULES.includes(m));
    if (unsupported.length > 0) {
      throw new HttpError(422, 'MODULE_NOT_AVAILABLE', 'Modul belum tersedia di dashboard MVP.');
    }
    const target = getTarget(input.targetId);
    const key = req.headers['idempotency-key'];
    const idempotencyKey =
      typeof key === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(key) ? key : undefined;
    const grant = createScopeGrant(
      target.origin,
      target.mode === 'fixture' ? 'local-fixture' : 'remote',
    );
    const run = deps.orchestrator.createRun({
      target,
      grant,
      modules: input.modules,
      acknowledged: input.acknowledged,
      ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
    });
    // Eksekusi berjalan di latar belakang; satu run aktif, sisanya menunggu di QUEUED.
    starts.startOnce(run.id, () => deps.orchestrator.start(run.id));
    return { kind: 'json', status: 202, body: runJson(run.id) };
  });

  add('GET', '/api/runs', false, (_p, _b, q) => {
    const limit = Math.min(100, Math.max(1, Number(q.get('limit') ?? '50') || 50));
    return {
      kind: 'json',
      status: 200,
      body: { items: deps.store.runs.list({ limit }).map((r) => runSummary(r.id)) },
    };
  });

  add('GET', '/api/runs/:id', false, (p) => ({
    kind: 'json',
    status: 200,
    body: runJson(getRun(p['id'] ?? '').id),
  }));

  add('POST', '/api/runs/:id/cancel', false, (p) => {
    getRun(p['id'] ?? '');
    const run = deps.orchestrator.cancel(p['id'] ?? '');
    return { kind: 'json', status: 200, body: { id: run.id, status: run.status } };
  });

  add('GET', '/api/runs/:id/findings', false, (p, _b, q) => {
    const run = getRun(p['id'] ?? '');
    const limit = Math.min(200, Math.max(1, Number(q.get('limit') ?? '50') || 50));
    const offset = Math.max(0, Number(q.get('offset') ?? '0') || 0);
    const page = deps.store.findings.listByRun(run.id, { limit, offset });
    return {
      kind: 'json',
      status: 200,
      body: {
        total: page.total,
        items: page.items.map((f) => ({
          id: f.id,
          title: f.title,
          description: f.description,
          category: f.category,
          severity: f.severity,
          verification: f.verification,
          status: f.status,
          ruleId: f.ruleId,
          ruleVersion: f.ruleVersion,
          selector: f.selector,
          targetUrl: f.targetUrl,
          evidenceRefs: f.evidenceRefs,
          expected: f.expected,
          actual: f.actual,
          remediation: f.remediation,
        })),
      },
    };
  });

  add('GET', '/api/runs/:id/artifacts', false, (p) => {
    const run = getRun(p['id'] ?? '');
    return {
      kind: 'json',
      status: 200,
      body: {
        items: deps.store.evidence.listByRun(run.id).map((e) => ({
          id: e.id,
          kind: e.kind,
          mimeType: e.mimeType,
          sizeBytes: e.sizeBytes,
          sha256: e.sha256,
          sourceTool: e.sourceTool,
          description: e.description,
          synthetic: e.synthetic,
          redactionApplied: e.redactionApplied,
          createdAt: e.createdAt,
        })),
      },
    };
  });

  add('GET', '/api/artifacts/:id', false, (p) => {
    const id = p['id'] ?? '';
    if (!/^evd_[a-f0-9]{32}$/.test(id))
      throw new HttpError(400, 'VALIDATION_FAILED', 'ID tidak valid.');
    const ev = deps.store.evidence.get(id);
    if (!ev) throw new HttpError(404, 'NOT_FOUND', 'Artefak tidak ditemukan.');
    const data = deps.artifacts.readVerified(id);
    const ext =
      ev.mimeType === 'application/json' ? 'json' : ev.mimeType === 'text/html' ? 'html' : 'txt';
    return { kind: 'file', filename: `${id}.${ext}`, data };
  });

  add('POST', '/api/runs/:id/report', false, (p) => {
    const run = getRun(p['id'] ?? '');
    if (!TERMINAL.has(run.status)) {
      throw new HttpError(409, 'CONFLICT', 'Laporan hanya dibuat setelah run selesai.');
    }
    const target = getTarget(run.targetId);
    const saved = saveReport(
      deps.artifacts,
      buildReport({
        run,
        moduleResults: deps.store.modules.listByRun(run.id),
        findings: deps.store.findings.listByRun(run.id, { limit: 500 }).items,
        evidence: deps.store.evidence.listByRun(run.id),
        generatedAt: now(),
        synthetic: target.mode === 'fixture',
        limitations: [
          'Hasil hanya untuk target yang diotorisasi dan cakupan yang tercatat.',
          'Pemeriksaan deterministik tidak mengukur seluruh aspek keamanan atau UX.',
          'Tidak ada klaim bebas bug atau aman sepenuhnya.',
        ],
      }),
    );
    return {
      kind: 'json',
      status: 201,
      body: { json: saved.json.id, html: saved.html.id, markdown: saved.markdown.id },
    };
  });

  add('GET', '/api/providers/status', false, () => ({
    kind: 'json',
    status: 200,
    body: deps.aiSettings.status(),
  }));

  add('GET', '/api/settings', false, () => ({
    kind: 'json',
    status: 200,
    body: deps.aiSettings.status(),
  }));

  add('PUT', '/api/settings', true, (_p, body) => {
    const update = parseSettingsUpdate(body);
    deps.aiSettings.update(update);
    return { kind: 'json', status: 200, body: deps.aiSettings.status() };
  });

  add('POST', '/api/settings/reset-counters', false, () => {
    deps.aiSettings.resetLocalCounters();
    return { kind: 'json', status: 200, body: deps.aiSettings.status() };
  });

  add('POST', '/api/providers/test', true, async (_p, body) => {
    parseBody(ProviderTestSchema, body);
    const outcome = await deps.aiService.testConnection();
    return { kind: 'json', status: 200, body: outcome };
  });

  function runSummary(id: string) {
    const run = deps.store.runs.get(id);
    if (!run) throw new HttpError(404, 'NOT_FOUND', 'Run tidak ditemukan.');
    return {
      id: run.id,
      status: run.status,
      targetOrigin: run.targetOrigin,
      targetMode: run.targetMode,
      createdAt: run.createdAt,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      errorSummary: run.errorSummary,
    };
  }

  function runJson(id: string) {
    const run = deps.store.runs.get(id);
    if (!run) throw new HttpError(404, 'NOT_FOUND', 'Run tidak ditemukan.');
    const modules = deps.store.modules.listByRun(run.id).map((m) => ({
      id: m.id,
      module: m.module,
      status: m.status,
      errorCode: m.errorCode,
      errorMessageSafe: m.errorMessageSafe,
      skippedReason: m.skippedReason,
      toolName: m.toolName,
      toolVersion: m.toolVersion,
      metrics: m.metrics,
    }));
    const total = deps.store.findings.listByRun(run.id, { limit: 1 }).total;
    return {
      ...runSummary(run.id),
      modules,
      findingsTotal: total,
      authorizationSummary: run.authorization.scopeSummary,
    };
  }

  function matchRoute(method: string, path: string): Route | null {
    for (const entry of routes) {
      if (entry.method !== method) continue;
      const m = entry.pattern.exec(path);
      if (!m) continue;
      const params: Record<string, string> = {};
      for (let i = 0; i < entry.keys.length; i++) {
        const key = entry.keys[i];
        if (key === undefined) continue;
        try {
          params[key] = decodeURIComponent(m[i + 1] ?? '');
        } catch {
          // Persen-encoding tidak valid (mis. %E0) adalah kesalahan input klien, bukan galat server.
          throw new HttpError(400, 'VALIDATION_FAILED', 'ID tidak valid.');
        }
      }
      return { ...entry.route, params };
    }
    return null;
  }

  return { handle };
}

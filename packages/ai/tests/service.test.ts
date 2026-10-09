import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadConfig, type AppConfig } from '@nusawebbench/core';
import { Store } from '@nusawebbench/storage';
import { createRun, createTarget } from '@nusawebbench/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  AiService,
  GeminiClient,
  aiFindingVerification,
  GroqClient,
  MODEL_REGISTRY,
  SETTINGS_KEYS,
  TASK_REQUIREMENTS,
  type FetchLike,
  type ModelEntry,
  type AiOutcome,
} from '../src/index.js';

const CANARY_KEY = `AIza${'Z'.repeat(35)}`;
const CANARY_SECRET = `gsk_${'Y'.repeat(40)}`;
const NOW = new Date('2026-10-09T03:00:00Z');

/** Registry uji: entri yang sengaja di-allowlist (free-tier) agar jalur sukses dapat diuji. */
const GEMINI_TEST: ModelEntry = {
  provider: 'gemini',
  model: 'gemini-test',
  capabilities: { text: true, json: true, image: false },
  freeTierAllowlisted: true,
  verifiedOn: '2026-10-09',
  source: 'uji',
};
const GROQ_TEST: ModelEntry = {
  provider: 'groq',
  model: 'groq-test',
  capabilities: { text: true, json: false, image: false },
  freeTierAllowlisted: true,
  verifiedOn: '2026-10-09',
  source: 'uji',
};
const REG: ModelEntry[] = [GEMINI_TEST, GROQ_TEST];

type Call = { url: string; body: string };

function fetchQueue(responses: Array<(c: Call) => Response | Promise<Response>>): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: String(init.body ?? '') });
    const next = responses.shift() ?? (() => new Response('{}', { status: 500 }));
    return next({ url, body: String(init.body ?? '') });
  };
  return { fetch, calls };
}
const ok =
  (text = 'Jawaban uji') =>
  () =>
    new Response(
      JSON.stringify({
        candidates: [{ content: { parts: [{ text }] } }],
        usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 2 },
      }),
      { status: 200 },
    );
const status =
  (code: number, headers: Record<string, string> = {}) =>
  () =>
    new Response('{}', { status: code, headers });

function cfg(over: Record<string, string> = {}): AppConfig {
  // FREE_TIER_LOCK tetap true: core menolak AI aktif dengan lock mati (T-020). Jalur sukses memakai
  // registry uji yang di-allowlist, bukan melonggarkan lock.
  const base = loadConfig({
    AI_PROVIDER: 'gemini',
    FREE_TIER_LOCK: 'true',
    AI_ALLOW_EXTERNAL_DATA: 'true',
    GEMINI_API_KEY: CANARY_KEY,
    GEMINI_MODEL: 'gemini-test',
    ...over,
  });
  return base;
}

let dir: string;
let dbPath: string;
let store: Store;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'nwb-ai-'));
  dbPath = path.join(dir, 'db.sqlite');
  store = Store.open(dbPath);
  store.settings.set(SETTINGS_KEYS.consent, true, NOW);
});
afterEach(() => {
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

function service(
  config: AppConfig,
  responses: Array<(c: Call) => Response | Promise<Response>>,
  extra: { registry?: ModelEntry[]; store?: Store } = {},
) {
  const q = fetchQueue(responses);
  const svc = new AiService({
    store: extra.store ?? store,
    config,
    clients: {
      gemini: new GeminiClient(config.GEMINI_API_KEY, q.fetch, () => NOW),
      groq: new GroqClient(config.GROQ_API_KEY || 'gsk_placeholder_uji', q.fetch, () => NOW),
    },
    registry: extra.registry ?? REG,
    now: () => NOW,
    sleep: async () => undefined,
  });
  return { svc, calls: q.calls };
}

const TEXT_REQ = { task: 'TEXT_SUMMARY' as const, prompt: 'Ringkas temuan ini.' };

describe('AiService — gerbang dan routing', () => {
  it('AI_PROVIDER=none → provider-disabled, tanpa panggilan', async () => {
    const { svc, calls } = service(cfg({ AI_PROVIDER: 'none' }), []);
    expect(await svc.run(TEXT_REQ)).toMatchObject({
      status: 'AI_UNAVAILABLE',
      reason: 'provider-disabled',
    });
    expect(calls).toHaveLength(0);
  });

  it('izin operator dimatikan → operator-external-data-disabled', async () => {
    const { svc } = service(cfg({ AI_ALLOW_EXTERNAL_DATA: 'false' }), []);
    expect(await svc.run(TEXT_REQ)).toMatchObject({ reason: 'operator-external-data-disabled' });
  });

  it('consent tidak ada, lalu dicabut → consent-missing', async () => {
    const { svc, calls } = service(cfg(), [ok()]);
    store.settings.set(SETTINGS_KEYS.consent, false, NOW);
    expect(await svc.run(TEXT_REQ)).toMatchObject({ reason: 'consent-missing' });
    expect(calls).toHaveLength(0);
  });

  it('FREE_TIER_LOCK=true menolak model yang tidak di-allowlist free-tier', async () => {
    const locked: ModelEntry[] = [{ ...GEMINI_TEST, freeTierAllowlisted: false }];
    const { svc, calls } = service(cfg(), [ok()], { registry: locked });
    const outcome = await svc.run(TEXT_REQ);
    expect(outcome).toMatchObject({ reason: 'free-tier-lock' });
    expect(calls).toHaveLength(0);
  });

  it('model kosong → model-not-configured; model tak dikenal → model-not-allowlisted', async () => {
    const blank = service({ ...cfg(), GEMINI_MODEL: '' }, []);
    expect(await blank.svc.run(TEXT_REQ)).toMatchObject({ reason: 'model-not-configured' });
    const unknown = service({ ...cfg(), GEMINI_MODEL: 'model-liar' }, []);
    expect(await unknown.svc.run(TEXT_REQ)).toMatchObject({ reason: 'model-not-allowlisted' });
  });

  it('kunci hilang → provider-key-missing', async () => {
    const { svc } = service({ ...cfg(), GEMINI_API_KEY: '' }, []);
    expect(await svc.run(TEXT_REQ)).toMatchObject({ reason: 'provider-key-missing' });
  });

  it('matriks routing: task gambar tidak pernah jatuh ke model teks saja', () => {
    const { svc } = service(cfg(), []);
    expect(svc.route('VISUAL_REVIEW')).toBe('capability-mismatch');
    expect(svc.route('STRUCTURED_REMEDIATION')).toMatchObject({
      provider: 'gemini',
      model: 'gemini-test',
    });
    const groqOnly = service(
      cfg({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'gsk_placeholder_uji', GROQ_MODEL: 'groq-test' }),
      [],
    );
    expect(groqOnly.svc.route('STRUCTURED_REMEDIATION')).toBe('capability-mismatch');
    expect(groqOnly.svc.route('TEXT_SUMMARY')).toMatchObject({ provider: 'groq' });
  });

  it('matriks: setiap task dipetakan ke kapabilitas, dan registry tidak mengklaim gambar', () => {
    expect(Object.keys(TASK_REQUIREMENTS).sort()).toEqual([
      'FINDING_EXPLANATION',
      'STRUCTURED_REMEDIATION',
      'TEXT_SUMMARY',
      'VISUAL_REVIEW',
    ]);
    expect(MODEL_REGISTRY.every((m) => m.capabilities.image === false)).toBe(true);
  });

  it('fallback hanya bila diaktifkan operator; tanpa itu, primary gagal berarti berhenti', () => {
    const c = { ...cfg(), GEMINI_MODEL: '' };
    const { svc } = service(
      { ...c, GROQ_MODEL: 'groq-test', GROQ_API_KEY: 'gsk_placeholder_uji' },
      [],
    );
    expect(svc.route('TEXT_SUMMARY')).toBe('model-not-configured');
    const withFallback = service(
      {
        ...c,
        GEMINI_MODEL: '',
        AI_FALLBACK_ENABLED: true,
        GROQ_MODEL: 'groq-test',
        GROQ_API_KEY: 'gsk_placeholder_uji',
      },
      [],
    );
    expect(withFallback.svc.route('TEXT_SUMMARY')).toMatchObject({
      provider: 'groq',
      fallbackFrom: 'gemini',
      fallbackReason: 'primary-unavailable:gemini',
    });
  });
});

describe('AiService — validasi input dan output', () => {
  it('prompt terlalu panjang ditolak sebelum panggilan', async () => {
    const { svc, calls } = service(cfg(), [ok()]);
    expect(await svc.run({ task: 'TEXT_SUMMARY', prompt: 'a'.repeat(8_001) })).toMatchObject({
      reason: 'input-too-long',
    });
    expect(calls).toHaveLength(0);
  });

  it('gambar: MIME tidak didukung, terlalu banyak, atau tidak ada untuk VISUAL → image-invalid', async () => {
    // Registry uji yang mengklaim kapabilitas gambar: validasi berjalan sebelum panggilan apa pun.
    const imgRegistry: ModelEntry[] = [
      { ...GEMINI_TEST, capabilities: { text: true, json: true, image: true } },
    ];
    const { svc, calls } = service(cfg(), [ok()], { registry: imgRegistry });
    const gif = await svc.run({
      task: 'VISUAL_REVIEW',
      prompt: 'x',
      images: [{ mime: 'image/gif', data: Buffer.from('g') }],
    });
    expect(gif).toMatchObject({ reason: 'image-invalid' });
    const none = await svc.run({ task: 'VISUAL_REVIEW', prompt: 'x' });
    expect(none).toMatchObject({ reason: 'image-invalid' });
    expect(calls).toHaveLength(0);
  });

  it('output melebihi batas karakter → INVALID_RESPONSE dan tidak dipakai', async () => {
    const huge = 'x'.repeat(16_001);
    const { svc } = service(cfg(), [ok(huge), ok(huge), ok(huge)]);
    const out = await svc.run(TEXT_REQ);
    expect(out).toMatchObject({ status: 'AI_UNAVAILABLE', errorKind: 'INVALID_RESPONSE' });
  });

  it('temuan dari AI tidak pernah CONFIRMED', () => {
    expect(aiFindingVerification('CONFIRMED')).toBe('LIKELY');
    expect(aiFindingVerification('INFORMATIONAL')).toBe('INFORMATIONAL');
  });
});

describe('AiService — keberhasilan, redaksi, dan usage', () => {
  it('jalur sukses: teks dikembalikan, prompt dikirim sudah diredaksi, usage tercatat', async () => {
    const { svc, calls } = service(cfg(), [ok('Ringkasan sukses')]);
    const out = (await svc.run({
      task: 'TEXT_SUMMARY',
      prompt: `Token ${CANARY_SECRET} di log`,
    })) as Extract<AiOutcome, { status: 'OK' }>;
    expect(out.status).toBe('OK');
    expect(out.text).toBe('Ringkasan sukses');
    expect(out.inputTokens).toBe(7);
    expect(calls[0]?.body).not.toContain(CANARY_SECRET);
    expect(calls[0]?.body).not.toContain(CANARY_KEY);
    const usage = store.usage.list(10);
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      provider: 'gemini',
      status: 'OK',
      requestCount: 1,
      estimatedCost: null,
    });
  });

  it('429 → RATE_LIMITED tanpa retry loop; usage RATE_LIMITED tercatat', async () => {
    const { svc, calls } = service(cfg({ AI_MAX_RETRIES: '3' }), [
      status(429, { 'retry-after': '5' }),
      ok(),
    ]);
    const out = await svc.run(TEXT_REQ);
    expect(out).toMatchObject({
      status: 'AI_UNAVAILABLE',
      errorKind: 'RATE_LIMITED',
      retryAfterSec: 5,
    });
    expect(calls).toHaveLength(1);
    expect(store.usage.list(5)[0]?.status).toBe('RATE_LIMITED');
  });

  it('5xx diulang terbatas: AI_MAX_RETRIES=2 → 3 percobaan lalu gagal', async () => {
    const { svc, calls } = service(cfg({ AI_MAX_RETRIES: '2' }), [
      status(500),
      status(502),
      status(503),
      ok(),
    ]);
    const out = await svc.run(TEXT_REQ);
    expect(out).toMatchObject({ status: 'AI_UNAVAILABLE', errorKind: 'UNKNOWN' });
    expect(calls).toHaveLength(3);
  });

  it('5xx sementara lalu sukses → OK pada percobaan kedua', async () => {
    const { svc, calls } = service(cfg({ AI_MAX_RETRIES: '1' }), [status(500), ok('Berhasil')]);
    const out = await svc.run(TEXT_REQ);
    expect(out).toMatchObject({ status: 'OK', text: 'Berhasil', attempts: 2 });
    expect(calls).toHaveLength(2);
  });

  it('AUTH_ERROR tidak diulang', async () => {
    const { svc, calls } = service(cfg({ AI_MAX_RETRIES: '3' }), [status(401), ok()]);
    expect(await svc.run(TEXT_REQ)).toMatchObject({ errorKind: 'AUTH_ERROR' });
    expect(calls).toHaveLength(1);
  });

  it('batas harian lokal: kedua panggilan setelah kuota habis ditolak tanpa request', async () => {
    const { svc, calls } = service(
      cfg({ AI_MAX_REQUESTS_PER_DAY: '1', AI_MAX_REQUESTS_PER_RUN: '1' }),
      [ok(), ok()],
    );
    expect(await svc.run(TEXT_REQ)).toMatchObject({ status: 'OK' });
    expect(await svc.run(TEXT_REQ)).toMatchObject({ reason: 'local-quota-exhausted' });
    expect(calls).toHaveLength(1);
  });

  it('batas per run: dua panggilan pada run yang sama, batas 1 → run-quota-exhausted', async () => {
    const target = createTarget({
      label: 'uji',
      origin: 'http://127.0.0.1:4178',
      mode: 'fixture',
      allowedModules: [],
      scopeConfirmedAt: null,
      now: NOW,
    });
    store.targets.insert(target);
    const runRow = createRun({
      targetId: target.id,
      targetOrigin: target.origin,
      targetMode: 'fixture',
      authorization: {
        acknowledged: true,
        scopeSummary: 'uji',
        scopeHash: null,
        approvedAt: NOW.toISOString(),
      },
      configSnapshot: {},
      now: NOW,
    });
    store.runs.insert(runRow);
    const runId = runRow.id;
    const { svc } = service(cfg({ AI_MAX_REQUESTS_PER_RUN: '1', AI_MAX_REQUESTS_PER_DAY: '10' }), [
      ok(),
      ok(),
    ]);
    expect(await svc.run({ ...TEXT_REQ, runId: runId })).toMatchObject({ status: 'OK' });
    expect(await svc.run({ ...TEXT_REQ, runId: runId })).toMatchObject({
      reason: 'run-quota-exhausted',
    });
  });

  it('dua panggilan bersamaan pada batas kuota: tepat satu yang mengirim request', async () => {
    const slow = async () => {
      await new Promise((r) => setTimeout(r, 30));
      return ok()();
    };
    const { svc, calls } = service(
      cfg({ AI_MAX_REQUESTS_PER_DAY: '1', AI_MAX_REQUESTS_PER_RUN: '1' }),
      [slow, slow],
    );
    const [a, b] = await Promise.all([svc.run(TEXT_REQ), svc.run(TEXT_REQ)]);
    const outcomes = [a.status, b.status].sort();
    expect(outcomes).toEqual(['AI_UNAVAILABLE', 'OK']);
    expect(
      [a, b].some((o) => o.status === 'AI_UNAVAILABLE' && o.reason === 'local-quota-exhausted'),
    ).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('kuota bertahan setelah restart (store dibuka ulang dari file yang sama)', async () => {
    const first = service(cfg({ AI_MAX_REQUESTS_PER_DAY: '1', AI_MAX_REQUESTS_PER_RUN: '1' }), [
      ok(),
    ]);
    expect(await first.svc.run(TEXT_REQ)).toMatchObject({ status: 'OK' });
    store.close();
    store = Store.open(dbPath);
    const second = service(
      cfg({ AI_MAX_REQUESTS_PER_DAY: '1', AI_MAX_REQUESTS_PER_RUN: '1' }),
      [ok()],
      { store },
    );
    expect(await second.svc.run(TEXT_REQ)).toMatchObject({ reason: 'local-quota-exhausted' });
    expect(second.calls).toHaveLength(0);
  });

  it('reset penghitung lokal membuka kuota lagi, tetapi riwayat usage tetap ada', async () => {
    const { svc } = service(cfg({ AI_MAX_REQUESTS_PER_DAY: '1', AI_MAX_REQUESTS_PER_RUN: '1' }), [
      ok(),
      ok(),
    ]);
    await svc.run(TEXT_REQ);
    const before = store.usage.list(100).length;
    store.settings.set(
      SETTINGS_KEYS.counterResetAt,
      new Date(NOW.getTime() + 1000).toISOString(),
      NOW,
    );
    const later = new Date(NOW.getTime() + 2000);
    const again = new AiService({
      store,
      config: cfg({ AI_MAX_REQUESTS_PER_DAY: '1', AI_MAX_REQUESTS_PER_RUN: '1' }),
      clients: { gemini: new GeminiClient(CANARY_KEY, fetchQueue([ok()]).fetch, () => later) },
      registry: REG,
      now: () => later,
      sleep: async () => undefined,
    });
    expect(await again.run(TEXT_REQ)).toMatchObject({ status: 'OK' });
    expect(store.usage.list(100).length).toBe(before + 1);
  });

  it('fallback dipakai dan dicatat (fallbackFrom) hanya saat diaktifkan', async () => {
    const config = cfg({
      GEMINI_API_KEY: '',
      GEMINI_MODEL: '',
      AI_FALLBACK_ENABLED: 'true',
      GROQ_API_KEY: 'gsk_placeholder_uji',
      GROQ_MODEL: 'groq-test',
    });
    const q = fetchQueue([
      () =>
        new Response(JSON.stringify({ choices: [{ message: { content: 'dari groq' } }] }), {
          status: 200,
        }),
    ]);
    const svc = new AiService({
      store,
      config,
      clients: { groq: new GroqClient('gsk_placeholder_uji', q.fetch, () => NOW) },
      registry: REG,
      now: () => NOW,
      sleep: async () => undefined,
    });
    const out = await svc.run(TEXT_REQ);
    expect(out).toMatchObject({
      status: 'OK',
      provider: 'groq',
      fallbackReason: 'primary-unavailable:gemini',
    });
    expect(store.usage.list(1)[0]?.fallbackFrom).toBe('gemini');
  });

  it('pembatalan dari pemanggil menghentikan panggilan tanpa retry', async () => {
    const controller = new AbortController();
    controller.abort();
    const hang: FetchLike = (_u, init) =>
      new Promise<Response>((_r, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('x'), { name: 'AbortError' })),
        );
      });
    const svc = new AiService({
      store,
      config: cfg({ AI_MAX_RETRIES: '3' }),
      clients: { gemini: new GeminiClient(CANARY_KEY, hang, () => NOW) },
      registry: REG,
      now: () => NOW,
      sleep: async () => undefined,
    });
    const out = await svc.run({ ...TEXT_REQ, signal: controller.signal });
    expect(out.status).toBe('AI_UNAVAILABLE');
  });

  it('kunci API tidak pernah masuk ke tabel usage', async () => {
    const { svc } = service(cfg(), [ok()]);
    await svc.run(TEXT_REQ);
    expect(JSON.stringify(store.usage.list(10))).not.toContain(CANARY_KEY);
  });
});

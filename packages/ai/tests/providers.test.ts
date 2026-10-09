import { describe, expect, it } from 'vitest';
import {
  GeminiClient,
  GroqClient,
  ProviderCallError,
  parseRetryAfter,
  type FetchLike,
} from '../src/index.js';

const NOW = new Date('2026-10-09T03:00:00Z');
const KEY = `AIza${'K'.repeat(35)}`;

type Call = { url: string; init: RequestInit };
function fakeFetch(handler: (call: Call, n: number) => Response | Promise<Response> | never): {
  fetch: FetchLike;
  calls: Call[];
} {
  const calls: Call[] = [];
  const fetch: FetchLike = async (url, init) => {
    const call = { url, init };
    calls.push(call);
    return handler(call, calls.length);
  };
  return { fetch, calls };
}
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
const geminiOk = (text = 'Ringkasan singkat') => ({
  candidates: [{ content: { parts: [{ text }] } }],
  usageMetadata: { promptTokenCount: 12, candidatesTokenCount: 4 },
});
const groqOk = (text = 'Ringkasan singkat') => ({
  choices: [{ message: { content: text } }],
  usage: { prompt_tokens: 9, completion_tokens: 5 },
});
const signal = () => new AbortController().signal;
const req = (
  over: Partial<{
    model: string;
    timeoutMs: number;
    images: { mime: string; data: Buffer }[];
  }> = {},
) => ({
  model: over.model ?? 'gemini-test',
  prompt: 'Jelaskan temuan ini.',
  images: over.images ?? [],
  maxOutputTokens: 200,
  timeoutMs: over.timeoutMs ?? 5_000,
  signal: signal(),
});

async function errorOf(p: Promise<unknown>): Promise<ProviderCallError> {
  try {
    await p;
  } catch (err) {
    if (err instanceof ProviderCallError) return err;
    throw err;
  }
  throw new Error('diharapkan galat');
}

describe('Gemini client (fake HTTP)', () => {
  it('respons valid: teks dan token dibaca; kunci hanya di header, tidak di URL', async () => {
    const f = fakeFetch(() => json(200, geminiOk()));
    const out = await new GeminiClient(KEY, f.fetch, () => NOW).generate(req());
    expect(out.text).toBe('Ringkasan singkat');
    expect(out.inputTokens).toBe(12);
    expect(out.outputTokens).toBe(4);
    expect(f.calls[0]?.url).not.toContain(KEY);
    expect((f.calls[0]?.init.headers as Record<string, string>)['x-goog-api-key']).toBe(KEY);
    expect(f.calls[0]?.url).toContain('/models/gemini-test:generateContent');
  });

  it('401/403 → AUTH_ERROR; 404 → MODEL_UNAVAILABLE; keduanya tidak diulang', async () => {
    for (const status of [401, 403]) {
      const e = await errorOf(
        new GeminiClient(KEY, fakeFetch(() => json(status, {})).fetch, () => NOW).generate(req()),
      );
      expect(e.kind).toBe('AUTH_ERROR');
      expect(e.retryable).toBe(false);
    }
    const m = await errorOf(
      new GeminiClient(KEY, fakeFetch(() => json(404, {})).fetch, () => NOW).generate(
        req({ model: 'model-tak-dikenal' }),
      ),
    );
    expect(m.kind).toBe('MODEL_UNAVAILABLE');
  });

  it('429 dengan Retry-After valid: RATE_LIMITED, tidak diulang, detik dibaca', async () => {
    const e = await errorOf(
      new GeminiClient(
        KEY,
        fakeFetch(() => json(429, {}, { 'retry-after': '7' })).fetch,
        () => NOW,
      ).generate(req()),
    );
    expect(e.kind).toBe('RATE_LIMITED');
    expect(e.retryable).toBe(false);
    expect(e.retryAfterSec).toBe(7);
  });

  it('429 dengan Retry-After rusak diabaikan (null), bukan dijadikan jadwal', async () => {
    const e = await errorOf(
      new GeminiClient(
        KEY,
        fakeFetch(() => json(429, {}, { 'retry-after': '-5' })).fetch,
        () => NOW,
      ).generate(req()),
    );
    expect(e.retryAfterSec).toBeNull();
  });

  it('5xx → UNKNOWN dan retryable; malformed JSON → INVALID_RESPONSE', async () => {
    const s = await errorOf(
      new GeminiClient(KEY, fakeFetch(() => json(503, {})).fetch, () => NOW).generate(req()),
    );
    expect(s.kind).toBe('UNKNOWN');
    expect(s.retryable).toBe(true);
    const m = await errorOf(
      new GeminiClient(KEY, fakeFetch(() => json(200, '{bukan json')).fetch, () => NOW).generate(
        req(),
      ),
    );
    expect(m.kind).toBe('INVALID_RESPONSE');
  });

  it('kandidat kosong / teks kosong → INVALID_RESPONSE', async () => {
    const a = await errorOf(
      new GeminiClient(
        KEY,
        fakeFetch(() => json(200, { candidates: [] })).fetch,
        () => NOW,
      ).generate(req()),
    );
    expect(a.kind).toBe('INVALID_RESPONSE');
    const b = await errorOf(
      new GeminiClient(KEY, fakeFetch(() => json(200, geminiOk('   '))).fetch, () => NOW).generate(
        req(),
      ),
    );
    expect(b.kind).toBe('INVALID_RESPONSE');
  });

  it('metadata usage tidak valid → token null, jawaban tetap dipakai', async () => {
    const out = await new GeminiClient(
      KEY,
      fakeFetch(() =>
        json(200, {
          candidates: [{ content: { parts: [{ text: 'ok' }] } }],
          usageMetadata: { promptTokenCount: -3 },
        }),
      ).fetch,
      () => NOW,
    ).generate(req());
    expect(out.text).toBe('ok');
    expect(out.inputTokens).toBeNull();
  });

  it('respons melebihi batas ukuran → INVALID_RESPONSE', async () => {
    const big = 'x'.repeat(1_100_000);
    const e = await errorOf(
      new GeminiClient(
        KEY,
        fakeFetch(() => json(200, `{"candidates":[{"content":{"parts":[{"text":"${big}"}]}}]}`))
          .fetch,
        () => NOW,
      ).generate(req()),
    );
    expect(e.kind).toBe('INVALID_RESPONSE');
  });

  it('timeout (fetch menunggu sinyal) → TIMEOUT retryable', async () => {
    const hang: FetchLike = (_u, init) =>
      new Promise<Response>((_r, reject) => {
        init.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    const e = await errorOf(
      new GeminiClient(KEY, hang, () => NOW).generate(req({ timeoutMs: 30 })),
    );
    expect(e.kind).toBe('TIMEOUT');
    expect(e.retryable).toBe(true);
  });

  it('gagal jaringan → NETWORK_ERROR retryable', async () => {
    const down: FetchLike = async () => {
      throw new TypeError('fetch failed');
    };
    const e = await errorOf(new GeminiClient(KEY, down, () => NOW).generate(req()));
    expect(e.kind).toBe('NETWORK_ERROR');
    expect(e.retryable).toBe(true);
  });

  it('permintaan dengan gambar ditolak sebelum HTTP (tidak ada panggilan)', async () => {
    const f = fakeFetch(() => json(200, geminiOk()));
    const e = await errorOf(
      new GeminiClient(KEY, f.fetch, () => NOW).generate(
        req({ images: [{ mime: 'image/png', data: Buffer.from('x') }] }),
      ),
    );
    expect(e.kind).toBe('UNKNOWN');
    expect(f.calls).toHaveLength(0);
  });
});

describe('Groq client (fake HTTP)', () => {
  it('endpoint OpenAI-compatible, max_completion_tokens, n=1, stream=false; token dibaca', async () => {
    const f = fakeFetch(() => json(200, groqOk()));
    const out = await new GroqClient('gsk_TEST', f.fetch, () => NOW).generate(
      req({ model: 'openai/gpt-oss-20b' }),
    );
    expect(out.text).toBe('Ringkasan singkat');
    expect(out.inputTokens).toBe(9);
    expect(f.calls[0]?.url).toBe('https://api.groq.com/openai/v1/chat/completions');
    const body = JSON.parse(String(f.calls[0]?.init.body)) as Record<string, unknown>;
    expect(body['max_completion_tokens']).toBe(200);
    expect(body['n']).toBe(1);
    expect(body['stream']).toBe(false);
    expect(body).not.toHaveProperty('max_tokens');
  });

  it('429 tanpa Retry-After → RATE_LIMITED tanpa retry; header x-ratelimit valid dicatat sebagai metadata', async () => {
    const e = await errorOf(
      new GroqClient('gsk_TEST', fakeFetch(() => json(429, {})).fetch, () => NOW).generate(req()),
    );
    expect(e.kind).toBe('RATE_LIMITED');
    expect(e.retryAfterSec).toBeNull();
    const ok = await new GroqClient(
      'gsk_TEST',
      fakeFetch(() =>
        json(200, groqOk(), {
          'x-ratelimit-remaining-requests': '14370',
          'x-ratelimit-remaining-tokens': 'banyak',
        }),
      ).fetch,
      () => NOW,
    ).generate(req());
    expect(ok.limitMetadata.remainingRequests).toBe(14370);
    expect(ok.limitMetadata.remainingTokens).toBeNull();
  });

  it('choices kosong → INVALID_RESPONSE; konten null → INVALID_RESPONSE', async () => {
    const a = await errorOf(
      new GroqClient(
        'gsk_TEST',
        fakeFetch(() => json(200, { choices: [] })).fetch,
        () => NOW,
      ).generate(req()),
    );
    expect(a.kind).toBe('INVALID_RESPONSE');
    const b = await errorOf(
      new GroqClient(
        'gsk_TEST',
        fakeFetch(() => json(200, { choices: [{ message: { content: null } }] })).fetch,
        () => NOW,
      ).generate(req()),
    );
    expect(b.kind).toBe('INVALID_RESPONSE');
  });
});

describe('parseRetryAfter', () => {
  it('detik, tanggal HTTP masa depan, dan nilai rusak', () => {
    expect(parseRetryAfter('12', NOW)).toBe(12);
    expect(parseRetryAfter('Fri, 09 Oct 2026 03:01:00 GMT', NOW)).toBe(60);
    expect(parseRetryAfter('1e9', NOW)).toBeNull();
    expect(parseRetryAfter('Fri, 01 Jan 2010 00:00:00 GMT', NOW)).toBeNull();
    expect(parseRetryAfter(null, NOW)).toBeNull();
  });
});

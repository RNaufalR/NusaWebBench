import { z } from 'zod';
import type { Provider } from '@nusawebbench/core';
import {
  ProviderCallError,
  classifyHttpStatus,
  parseLimitHeader as parseLimit,
  parseRetryAfter,
} from './errors.js';

/**
 * Klien provider. Semua panggilan HTTP melewati `fetchImpl` yang dapat diganti, sehingga unit test
 * memakai fake dan tidak pernah memanggil API nyata (taskbook T-110/T-120 instruksi 8/7).
 *
 * Sumber resmi (diambil 2026-10-09):
 * - Gemini: https://ai.google.dev/gemini-api/docs/rate-limits (RPM/TPM/RPD per proyek; 429 RESOURCE_EXHAUSTED).
 *   Path `models/{model}:generateContent` dan header `x-goog-api-key` berasal dari adapter ini dan
 *   BELUM dikonfirmasi pada halaman referensi (chunk 0–2 hanya berisi daftar isi). Wajib diverifikasi
 *   ulang pada smoke test manual sebelum dipakai.
 * - Groq: https://console.groq.com/docs/api-reference (POST /openai/v1/chat/completions; max_completion_tokens;
 *   n hanya 1; stream default false). https://console.groq.com/docs/rate-limits (429; retry-after;
 *   x-ratelimit-* header). Header Authorization Bearer mengikuti konvensi OpenAI-compatible.
 */

export const MAX_RESPONSE_BYTES = 1_000_000;

export type ProviderImage = { readonly mime: string; readonly data: Buffer };

export type ProviderRequest = {
  readonly model: string;
  readonly prompt: string;
  readonly images: readonly ProviderImage[];
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
};

export type ProviderResponse = {
  readonly text: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Metadata rate-limit dari header; hanya informasi, bukan sumber kebenaran kuota. */
  readonly limitMetadata: {
    readonly remainingRequests: number | null;
    readonly remainingTokens: number | null;
  };
};

export interface ProviderClient {
  readonly provider: Provider;
  generate(req: ProviderRequest): Promise<ProviderResponse>;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta';
const GROQ_BASE = 'https://api.groq.com/openai/v1';

const GeminiResponseSchema = z
  .object({
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({
                parts: z
                  .array(z.object({ text: z.string().max(200_000).optional() }).passthrough())
                  .optional(),
              })
              .passthrough()
              .optional(),
          })
          .passthrough(),
      )
      .optional(),
    usageMetadata: z.unknown().optional(),
  })
  .passthrough();

const GroqResponseSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            message: z.object({ content: z.string().max(200_000).nullable() }).passthrough(),
          })
          .passthrough(),
      )
      .min(1),
    usage: z.unknown().optional(),
  })
  .passthrough();

/** Metadata usage hanya informasi: nilai yang tidak valid menjadi null, tidak membatalkan jawaban. */
function tokenField(usage: unknown, key: string): number | null {
  if (typeof usage !== 'object' || usage === null) return null;
  const v = (usage as Record<string, unknown>)[key];
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null;
}

/** Membaca body dengan batas ukuran. Melebihi batas dianggap respons tidak valid. */
async function readBounded(res: Response): Promise<string> {
  const declared = res.headers.get('content-length');
  if (declared !== null && Number(declared) > MAX_RESPONSE_BYTES) {
    throw new ProviderCallError('INVALID_RESPONSE', false);
  }
  const text = await res.text();
  if (Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
    throw new ProviderCallError('INVALID_RESPONSE', false);
  }
  return text;
}

async function send(
  fetchImpl: FetchLike,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ status: number; body: string; headers: Headers }> {
  // Sinyal yang sudah dibatalkan tidak memicu event 'abort' lagi; cek eksplisit agar tidak menggantung.
  if (signal.aborted) throw new ProviderCallError('UNKNOWN', false);
  const controller = new AbortController();
  const onAbort = (): void => controller.abort();
  signal.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { ...init, signal: controller.signal });
    const body = await readBounded(res);
    return { status: res.status, body, headers: res.headers };
  } catch (err) {
    if (err instanceof ProviderCallError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ProviderCallError('TIMEOUT', true);
    }
    throw new ProviderCallError('NETWORK_ERROR', true);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

function failFromStatus(status: number, headers: Headers, now: Date): never {
  const cls = classifyHttpStatus(status);
  const retryAfter = status === 429 ? parseRetryAfter(headers.get('retry-after'), now) : null;
  throw new ProviderCallError(cls.kind, cls.retryable, retryAfter);
}

function parseJson(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new ProviderCallError('INVALID_RESPONSE', false);
  }
}

export class GeminiClient implements ProviderClient {
  readonly provider = 'gemini' as const;
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    if (req.images.length > 0) {
      // Adapter ini belum memverifikasi dukungan gambar; router tidak pernah memilih Gemini untuk VISUAL_REVIEW.
      throw new ProviderCallError('UNKNOWN', false);
    }
    const url = `${GEMINI_BASE}/models/${encodeURIComponent(req.model)}:generateContent`;
    const body = JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: { maxOutputTokens: req.maxOutputTokens },
    });
    const res = await send(
      this.fetchImpl,
      url,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': this.apiKey },
        body,
      },
      req.timeoutMs,
      req.signal,
    );
    if (res.status < 200 || res.status > 299) failFromStatus(res.status, res.headers, this.now());
    const parsed = GeminiResponseSchema.safeParse(parseJson(res.body));
    if (!parsed.success) throw new ProviderCallError('INVALID_RESPONSE', false);
    const parts = parsed.data.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? '').join('');
    if (text.trim() === '') throw new ProviderCallError('INVALID_RESPONSE', false);
    return {
      text,
      inputTokens: tokenField(parsed.data.usageMetadata, 'promptTokenCount'),
      outputTokens: tokenField(parsed.data.usageMetadata, 'candidatesTokenCount'),
      limitMetadata: { remainingRequests: null, remainingTokens: null },
    };
  }
}

export class GroqClient implements ProviderClient {
  readonly provider = 'groq' as const;
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: FetchLike = (u, i) => fetch(u, i),
    private readonly now: () => Date = () => new Date(),
  ) {}

  async generate(req: ProviderRequest): Promise<ProviderResponse> {
    if (req.images.length > 0) throw new ProviderCallError('UNKNOWN', false);
    const body = JSON.stringify({
      model: req.model,
      messages: [{ role: 'user', content: req.prompt }],
      max_completion_tokens: req.maxOutputTokens,
      stream: false,
      n: 1,
    });
    const res = await send(
      this.fetchImpl,
      `${GROQ_BASE}/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.apiKey}` },
        body,
      },
      req.timeoutMs,
      req.signal,
    );
    if (res.status < 200 || res.status > 299) failFromStatus(res.status, res.headers, this.now());
    const parsed = GroqResponseSchema.safeParse(parseJson(res.body));
    if (!parsed.success) throw new ProviderCallError('INVALID_RESPONSE', false);
    const text = parsed.data.choices[0]?.message.content ?? '';
    if (text.trim() === '') throw new ProviderCallError('INVALID_RESPONSE', false);
    return {
      text,
      inputTokens: tokenField(parsed.data.usage, 'prompt_tokens'),
      outputTokens: tokenField(parsed.data.usage, 'completion_tokens'),
      limitMetadata: {
        remainingRequests: parseLimit(res.headers.get('x-ratelimit-remaining-requests')),
        remainingTokens: parseLimit(res.headers.get('x-ratelimit-remaining-tokens')),
      },
    };
  }
}

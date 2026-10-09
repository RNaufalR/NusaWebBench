import { AppError, safeText } from '@nusawebbench/core';
import { z } from 'zod';

/**
 * Nilai form yang dipakai untuk langkah `fillDummy`. Nilai ini sengaja tidak menyerupai
 * kredensial atau data pribadi, dan tidak pernah diambil dari input pengguna.
 */
export const DUMMY_FORM_VALUE = 'nwb-dummy-value';

/**
 * Label tombol yang menandakan aksi berisiko (pembayaran, penghapusan, pengiriman, keluar).
 * Langkah klik pada elemen seperti ini ditolak; alur QA tidak boleh mengubah data nyata.
 */
export const RISKY_CLICK_PATTERN =
  /bayar|pay|checkout|beli|buy|hapus|delete|remove|kirim|submit|logout|keluar|sign\s?out|transfer|order|pesan/i;

/**
 * Path URL relatif terhadap origin yang disetujui. Harus diawali satu `/`, tanpa `//` di awal
 * (protocol-relative), tanpa backslash, tanpa karakter kontrol, dan tanpa segmen `.`/`..`
 * (termasuk bentuk persen-encoded). Hasil akhirnya tetap diperiksa oleh guard scope.
 */
export const UrlPathSchema = z
  .string()
  .min(1)
  .max(260)
  .refine((p) => p.startsWith('/') && !p.startsWith('//'), {
    message: 'path-must-be-root-relative',
  })
  .refine((p) => !p.includes('\\') && !hasControlChars(p), {
    message: 'path-contains-forbidden-characters',
  })
  .refine((p) => !/(^|\/)(\.|%2e){1,2}(\/|$|\?|#)/i.test(p), { message: 'path-traversal-segment' });

/** True bila string memuat karakter kontrol (C0 atau DEL). */
function hasControlChars(value: string): boolean {
  for (const ch of value) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

const SelectorSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((v) => !hasControlChars(v), { message: 'selector-control-characters' });

export const FlowStepSchema = z.discriminatedUnion('action', [
  z.strictObject({ action: z.literal('goto'), path: UrlPathSchema }),
  z.strictObject({ action: z.literal('click'), selector: SelectorSchema }),
  z.strictObject({ action: z.literal('fillDummy'), selector: SelectorSchema }),
  z.strictObject({ action: z.literal('expectVisible'), selector: SelectorSchema }),
  z.strictObject({
    action: z.literal('expectText'),
    selector: SelectorSchema,
    text: safeText(200).min(1),
  }),
  z.strictObject({ action: z.literal('expectPath'), path: UrlPathSchema }),
  z.strictObject({
    action: z.literal('expectValidity'),
    selector: SelectorSchema,
    valid: z.boolean(),
  }),
  z.strictObject({
    action: z.literal('expectCount'),
    selector: SelectorSchema,
    count: z.number().int().min(0).max(100),
  }),
]);
export type FlowStep = z.infer<typeof FlowStepSchema>;

export const FlowSchema = z.strictObject({
  name: safeText(100).min(1),
  steps: z.array(FlowStepSchema).min(1).max(20),
});
export type Flow = z.infer<typeof FlowSchema>;

export const FunctionalQaConfigSchema = z.strictObject({
  /** Path awal relatif terhadap origin yang disetujui. */
  startPath: UrlPathSchema.default('/'),
  /** Path tambahan yang dimasukkan ke antrean crawl pada kedalaman 0. */
  extraPaths: z.array(UrlPathSchema).max(10).default([]),
  maxPages: z.number().int().min(1).max(10).default(5),
  maxDepth: z.number().int().min(0).max(2).default(1),
  linkCheckLimit: z.number().int().min(0).max(100).default(50),
  navigationTimeoutMs: z.number().int().min(1000).max(30000).default(10000),
  flows: z.array(FlowSchema).max(5).default([]),
});

export type FunctionalQaConfig = z.output<typeof FunctionalQaConfigSchema>;

/** Validasi konfigurasi. Pesan kesalahan tidak memuat nilai masukan mentah. */
export function parseFunctionalQaConfig(input: unknown): FunctionalQaConfig {
  const parsed = FunctionalQaConfigSchema.safeParse(input ?? {});
  if (!parsed.success) {
    throw new AppError('CONFIG_INVALID', {
      safeMessage: 'Konfigurasi QA fungsional tidak valid.',
    });
  }
  return parsed.data;
}

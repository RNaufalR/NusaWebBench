/**
 * Redaksi data sensitif (taskbook §5.2). Dipakai sebelum data keluar dari batas tepercaya:
 * log, laporan, respons API, dan prompt provider AI.
 *
 * Catatan keterbatasan: regex hanya menangkap pola yang dikenal. Redaksi harus diuji dengan
 * secret canary sintetis (lihat tests/unit/redact.test.ts), bukan dianggap lengkap.
 */

const REDACTED = '[REDACTED]';

/** Pola nilai secret berbentuk tetap (provider keys, token platform). */
const VALUE_PATTERNS: ReadonlyArray<{ kind: string; pattern: RegExp }> = [
  {
    kind: 'PEM_PRIVATE_KEY',
    pattern:
      /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/g,
  },
  { kind: 'GOOGLE_API_KEY', pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { kind: 'GROQ_API_KEY', pattern: /\bgsk_[A-Za-z0-9]{40,}\b/g },
  { kind: 'AWS_ACCESS_KEY_ID', pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'OPENAI_STYLE_KEY', pattern: /\bsk-(?:proj-|ant-[a-z0-9]+-|or-v1-)[A-Za-z0-9_-]{20,}/g },
  { kind: 'STRIPE_STYLE_KEY', pattern: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { kind: 'SLACK_TOKEN', pattern: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  {
    kind: 'GITHUB_TOKEN',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/g,
  },
  { kind: 'BEARER_TOKEN', pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/gi },
];

/** Nama field/parameter yang dianggap sensitif (case-insensitive, substring). */
const SENSITIVE_NAME =
  /(api[_-]?key|apikey|token|secret|password|passwd|pwd|auth|session|cookie|signature|sig|credential|private[_-]?key|access[_-]?key)/i;

/** Email dan nomor identitas 16 digit (format NIK Indonesia dan sejenisnya). */
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Nomor panjang hanya bila berdiri sendiri. Tanpa batas huruf, 16 digit di dalam ID hex acak
// (mis. run_<32 hex>) ikut tersensor dan membuat laporan gagal secara acak (~0,2% per ID).
const LONG_DIGITS = /(?<![A-Za-z0-9])\d{16}(?![A-Za-z0-9])/g;

/**
 * Meredaksi teks bebas: nilai secret berbentuk tetap, header sensitif, pasangan
 * `name=value` / `"name": "value"` untuk nama sensitif, email, dan nomor identitas 16 digit.
 */
export function redactText(input: string): string {
  let out = input;
  for (const { kind, pattern } of VALUE_PATTERNS) {
    out = out.replace(pattern, `[REDACTED:${kind}]`);
  }
  // Header: Authorization / Cookie / Set-Cookie — sisa baris dimasking.
  out = out.replace(
    /\b(authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]*/gi,
    (_m, name: string) => `${name}: ${REDACTED}`,
  );
  // Pasangan key=value atau key: value atau "key": "value" untuk nama sensitif.
  // Nilai bertanda kutip dibaca sampai kutip penutup (boleh memuat spasi/koma); nilai tanpa kutip
  // berhenti di pemisah umum. Sebelumnya `"password": "dua kata"` lolos tanpa redaksi.
  out = out.replace(
    /(["']?)([A-Za-z0-9_.-]*(?:api[_-]?key|token|secret|password|passwd|private[_-]?key|access[_-]?key)[A-Za-z0-9_.-]*)\1(\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"'&,;}\]]+)/gi,
    (m, q: string, name: string, sep: string) => {
      const value = m.slice(name.length + q.length * 2 + sep.length);
      const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : '';
      return `${q}${name}${q}${sep}${quote}${REDACTED}${quote}`;
    },
  );
  out = out.replace(EMAIL, '[EMAIL]');
  out = out.replace(LONG_DIGITS, '[ID_NUMBER]');
  return out;
}

/**
 * Meredaksi URL: menghapus userinfo, dan mengganti nilai query/fragment yang namanya sensitif.
 * Mengembalikan `null` jika input bukan URL yang dapat di-parse (jangan menampilkan input mentah).
 */
export function redactUrl(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  url.username = '';
  url.password = '';
  for (const key of [...url.searchParams.keys()]) {
    if (SENSITIVE_NAME.test(key)) {
      url.searchParams.set(key, REDACTED);
    }
  }
  if (url.hash) {
    // Fragment tidak dikirim ke server, tetapi bisa memuat token (mis. OAuth implicit).
    url.hash = '';
  }
  return url.toString();
}

/** Mengembalikan true jika teks mengandung pola secret yang dikenali. Untuk gerbang tambahan. */
export function containsKnownSecret(input: string): boolean {
  return VALUE_PATTERNS.some(({ pattern }) => {
    pattern.lastIndex = 0;
    const found = pattern.test(input);
    pattern.lastIndex = 0;
    return found;
  });
}

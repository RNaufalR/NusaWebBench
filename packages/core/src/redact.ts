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

/**
 * Nama field/parameter sensitif. Nama dipecah per kata (camelCase, snake_case, kebab-case) lalu
 * dicocokkan per kata, bukan substring mentah. Dengan begitu `author`, `tokenizer`, dan `keyboard`
 * tidak ikut tersensor, sedangkan `authToken`, `api_key`, `sessionId`, dan `x-api-key` tetap tertangkap.
 */
const SENSITIVE_EXACT = new Set([
  'token',
  'auth',
  'authorization',
  'pwd',
  'passwd',
  'sig',
  'sid',
  'apikey',
  'privatekey',
  'accesskey',
]);
/** Kata yang dianggap sensitif bila diawali kata ini (mis. `sessionid`, `secretValue`, `cookies`). */
const SENSITIVE_PREFIX = [
  'password',
  'secret',
  'session',
  'cookie',
  'credential',
  'signature',
  'apikey',
  'privatekey',
  'accesskey',
];

function splitNameWords(name: string): string[] {
  return name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((w) => w.length > 0)
    .map((w) => w.toLowerCase());
}

function isSensitiveWord(w: string): boolean {
  return SENSITIVE_EXACT.has(w) || SENSITIVE_PREFIX.some((p) => w.startsWith(p));
}

/** True bila nama field/parameter dianggap sensitif. Dipakai untuk teks bebas, JSON, dan query URL. */
export function isSensitiveKey(name: string): boolean {
  const words = splitNameWords(name);
  for (let i = 0; i < words.length; i++) {
    if (isSensitiveWord(words[i] ?? '')) return true;
    // Pasangan kata yang membentuk nama sensitif: `api` + `key`, `private` + `key`, `access` + `key`.
    if (i + 1 < words.length && isSensitiveWord((words[i] ?? '') + (words[i + 1] ?? '')))
      return true;
  }
  return false;
}

/** Email dan nomor identitas 16 digit (format NIK Indonesia dan sejenisnya). */
// Lookbehind: pencocokan hanya mulai di batas token. Tanpa ini, teks panjang tanpa '@' menjadi O(n²).
const EMAIL = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Nomor panjang hanya bila berdiri sendiri. Tanpa batas huruf, 16 digit di dalam ID hex acak
// (mis. run_<32 hex>) ikut tersensor dan membuat laporan gagal secara acak (~0,2% per ID).
const LONG_DIGITS = /(?<![A-Za-z0-9])\d{16}(?![A-Za-z0-9])/g;

/**
 * Meredaksi teks bebas: nilai secret berbentuk tetap, header sensitif, pasangan
 * `name=value` / `"name": "value"` untuk nama sensitif, email, dan nomor identitas 16 digit.
 */
export function redactText(input: string): string {
  const flat = redactFlat(input);
  const structured = redactJsonIfValid(input);
  if (structured === null) return flat;
  // Jalur regex mempertahankan format asli. Jalur terstruktur dipakai hanya bila hasil regex
  // berbeda secara struktur (mis. nilai objek/angka di bawah kunci sensitif yang terlewat regex).
  try {
    const a = JSON.stringify(JSON.parse(flat));
    const b = JSON.stringify(JSON.parse(structured));
    return a === b ? flat : structured;
  } catch {
    return structured;
  }
}

/**
 * Jika input adalah JSON valid (objek atau array), redaksi dilakukan per kunci di setiap level:
 * nilai untuk kunci sensitif diganti apa pun tipenya, sedangkan string lain diproses redactFlat.
 * Mengembalikan null bila bukan JSON valid, sehingga jalur regex dipakai.
 */
function redactJsonIfValid(input: string): string | null {
  const trimmed = input.trim();
  if (!(trimmed.startsWith('{') || trimmed.startsWith('['))) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const indentMatch = /\n( +)\S/.exec(input);
  const indent = indentMatch ? (indentMatch[1] ?? '').length : 0;
  return JSON.stringify(redactJsonValue(parsed), null, indent);
}

function redactJsonValue(value: unknown): unknown {
  if (typeof value === 'string') return redactFlat(value);
  if (Array.isArray(value)) return value.map(redactJsonValue);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const safeKey = redactFlat(k);
      out[safeKey] = isSensitiveKey(k) ? REDACTED : redactJsonValue(v);
    }
    return out;
  }
  return value;
}

/**
 * Memindai pasangan key=value, key: value, atau "key": "value".
 *
 * Desain linear (F-redaksi, DoS): regex hanya mencocokkan KUNCI dan pemisah, dengan lookbehind agar
 * hanya mulai di batas token. Nilai dibaca oleh pemindai manual dan hanya untuk kunci sensitif.
 * Sebelumnya regex menelan nilai dan memundurkan pemindaian, sehingga `k=k=k=...` berjalan O(n²)
 * (80 KB: 28 detik). Nilai bertanda kutip boleh memuat spasi dan escape. Nilai `[REDACTED...]` dibiarkan.
 */
function redactKeyValuePairs(text: string): string {
  const re = /(?<![A-Za-z0-9_.-])(["']?)([A-Za-z0-9_.-]+)\1(\s*[:=]\s*)/g;
  let out = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const [full, q = '', name = '', sep = ''] = m;
    if (!isSensitiveKey(name)) continue; // lastIndex sudah tepat setelah pemisah
    const valueStart = m.index + full.length;
    const valueEnd = readValueEnd(text, valueStart);
    if (valueEnd === valueStart) continue;
    const value = text.slice(valueStart, valueEnd);
    if (value.startsWith('[REDACTED')) continue;
    const quote = value.startsWith('"') ? '"' : value.startsWith("'") ? "'" : '';
    out += text.slice(last, m.index) + `${q}${name}${q}${sep}${quote}${REDACTED}${quote}`;
    last = valueEnd;
    re.lastIndex = valueEnd;
  }
  return out + text.slice(last);
}

/**
 * Mengembalikan indeks akhir nilai yang dimulai di `start`. Linear: setiap karakter dibaca sekali.
 * - Nilai bertanda kutip: sampai kutip penutup (escape `\\x` dilewati). Tanpa penutup, sampai akhir baris.
 * - Nilai tanpa kutip: sampai spasi, kutip, `&`, `,`, `;`, `}`, atau `]`.
 */
function readValueEnd(text: string, start: number): number {
  const first = text[start];
  if (first === '"' || first === "'") {
    let i = start + 1;
    while (i < text.length) {
      const c = text[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === first) return i + 1;
      if (c === '\r' || c === '\n') return i;
      i++;
    }
    return text.length;
  }
  let i = start;
  while (i < text.length && !/[\s"'&,;}\]]/.test(text[i] ?? '')) i++;
  return i;
}

function redactFlat(input: string): string {
  let out = input;
  for (const { kind, pattern } of VALUE_PATTERNS) {
    out = out.replace(pattern, `[REDACTED:${kind}]`);
  }
  // Header: Authorization / Cookie / Set-Cookie — sisa baris dimasking.
  out = out.replace(
    /\b(authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]*/gi,
    (_m, name: string) => `${name}: ${REDACTED}`,
  );
  out = redactKeyValuePairs(out);
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
    if (isSensitiveKey(key)) {
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

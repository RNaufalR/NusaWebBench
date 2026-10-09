// @ts-check
/**
 * Secret scanner untuk file yang dilacak Git.
 *
 * Desain:
 * - Tidak pernah mencetak nilai secret; hanya rule id, path, dan nomor baris.
 * - Dipanggil dengan argumen array (tanpa shell). Hanya membaca daftar file dari `git ls-files -z`.
 * - Exit code 1 jika ada temuan, 2 jika error internal/konfigurasi.
 */
import { execFile } from 'node:child_process';
import { lstat, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import path from 'node:path';

const execFileAsync = promisify(execFile);

/** Batas ukuran file yang dipindai (1 MiB). File lebih besar dilewati dan dilaporkan. */
export const MAX_SCAN_BYTES = 1024 * 1024;

/**
 * @typedef {{ id: string, description: string, pattern: RegExp }} SecretRule
 * @typedef {{ ruleId: string, file: string, line: number }} SecretFinding
 */

/**
 * Nilai placeholder yang diizinkan (contoh di .env.example atau dokumentasi).
 * Dicocokkan dengan nilai yang tertangkap, bukan seluruh baris.
 */
const PLACEHOLDER_VALUE =
  /^(?:<[^>]*>|x+|\*+|\.\.\.)$|changeme|change[-_]me|placeholder|example|dummy|redacted|^your[-_]/i;

/** @type {readonly SecretRule[]} */
export const RULES = Object.freeze([
  {
    id: 'private-key-block',
    description: 'PEM private key block',
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY(?: BLOCK)?-----/,
  },
  {
    id: 'aws-access-key-id',
    description: 'AWS access key id',
    pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/,
  },
  {
    id: 'github-token',
    description: 'GitHub token',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{60,})\b/,
  },
  {
    id: 'google-api-key',
    description: 'Google API key (format AIza)',
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    id: 'groq-api-key',
    description: 'Groq API key (format gsk_)',
    pattern: /\bgsk_[A-Za-z0-9]{40,}\b/,
  },
  {
    id: 'generic-secret-assignment',
    description: 'Assignment of a long literal to a secret-like name',
    pattern:
      /(?<![A-Za-z])(?:api[_-]?key|secret|token|password|passwd|private[_-]?key|access[_-]?key)(?![A-Za-z])["']?\s*[:=]\s*(["']?)([A-Za-z0-9_\-/+=.]{16,})\1/i,
  },
]);

/**
 * Memindai satu teks dan mengembalikan temuan tanpa nilai secret.
 * @param {string} file path relatif untuk pelaporan
 * @param {string} text isi file
 * @param {readonly SecretRule[]} [rules]
 * @returns {SecretFinding[]}
 */
export function scanText(file, text, rules = RULES) {
  /** @type {SecretFinding[]} */
  const findings = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((lineText, index) => {
    for (const rule of rules) {
      const match = rule.pattern.exec(lineText);
      if (!match) continue;
      if (rule.id === 'generic-secret-assignment') {
        const quote = match[1] ?? '';
        const value = match[2] ?? '';
        if (PLACEHOLDER_VALUE.test(value)) continue;
        // Nilai tanpa quote yang berbentuk identifier camelCase/snake_case tanpa digit
        // (mis. `password = someLongName;`) dianggap referensi variabel, bukan literal.
        // Nilai huruf kecil polos tetap dilaporkan karena bisa berupa secret.
        if (
          quote === '' &&
          /^[A-Za-z_$][\w$]*$/.test(value) &&
          /[A-Z_$]/.test(value.slice(1)) &&
          !/\d/.test(value)
        )
          continue;
      }
      findings.push({ ruleId: rule.id, file, line: index + 1 });
    }
  });
  return findings;
}

/**
 * Mengambil daftar file yang dilacak Git (relatif terhadap root repo).
 * @param {string} repoRoot
 * @returns {Promise<string[]>}
 */
export async function listTrackedFiles(repoRoot) {
  const { stdout } = await execFileAsync('git', ['ls-files', '-z'], {
    cwd: repoRoot,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout.split('\0').filter((entry) => entry.length > 0);
}

/**
 * Memindai seluruh file yang dilacak.
 * @param {string} repoRoot
 * @returns {Promise<{ findings: SecretFinding[], scanned: number, skipped: { file: string, reason: string }[] }>}
 */
export async function scanRepository(repoRoot) {
  const files = await listTrackedFiles(repoRoot);
  /** @type {SecretFinding[]} */
  const findings = [];
  /** @type {{ file: string, reason: string }[]} */
  const skipped = [];
  let scanned = 0;
  for (const rel of files) {
    const abs = path.join(repoRoot, rel);
    let info;
    try {
      info = await lstat(abs);
    } catch (err) {
      if (isNodeError(err) && err.code === 'ENOENT') {
        skipped.push({ file: rel, reason: 'missing-in-worktree' });
        continue;
      }
      throw err;
    }
    // Symlink tidak diikuti: target bisa berada di luar repo.
    if (!info.isFile()) {
      skipped.push({ file: rel, reason: 'not-a-regular-file' });
      continue;
    }
    if (info.size > MAX_SCAN_BYTES) {
      skipped.push({ file: rel, reason: 'too-large' });
      continue;
    }
    const buffer = await readFile(abs);
    if (buffer.includes(0)) {
      skipped.push({ file: rel, reason: 'binary' });
      continue;
    }
    scanned += 1;
    findings.push(...scanText(rel, buffer.toString('utf8')));
  }
  return { findings, scanned, skipped };
}

/**
 * @param {unknown} err
 * @returns {err is NodeJS.ErrnoException}
 */
function isNodeError(err) {
  return err instanceof Error && 'code' in err;
}

/** CLI entry point. */
async function main() {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url));
  try {
    const { findings, scanned, skipped } = await scanRepository(repoRoot);
    for (const s of skipped) {
      console.log(`SKIPPED ${s.file} (${s.reason})`);
    }
    for (const f of findings) {
      console.error(`SECRET-LIKE ${f.ruleId} at ${f.file}:${f.line} (value not shown)`);
    }
    console.log(`secret-scan: scanned=${scanned} findings=${findings.length}`);
    process.exitCode = findings.length > 0 ? 1 : 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown error';
    console.error(`secret-scan: internal error: ${message}`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}

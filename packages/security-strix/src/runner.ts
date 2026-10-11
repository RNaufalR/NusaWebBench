import { spawn } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  lstatSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { redactText } from '@nusawebbench/core';

/**
 * Runner Strix (taskbook T-160). Mengeksekusi CLI Strix v1.7.0 secara non-interaktif dan mem-parse
 * artefak run (`strix_runs/<run>/run.json` dan `vulnerabilities.json`).
 *
 * Kontrak yang diverifikasi dari sumber tag v1.7.0 (commit 55bc07991aacb1c26a81b43e7ca53148730d2019,
 * dibaca 2026-10-09):
 * - `-n/--non-interactive`, `-t/--target`, `-m/--scan-mode {quick,standard,deep}`,
 *   `--max-budget-usd`, `--max-turns`.
 * - Model dari env `STRIX_LLM` (route `provider/model`, mis. `gemini/gemini-3.8-flash`); kunci dari
 *   `LLM_API_KEY`. Telemetri dimatikan dengan `STRIX_TELEMETRY=false`; cek update dengan
 *   `STRIX_NO_UPDATE_CHECK=1`.
 * - Exit 0 = selesai tanpa temuan atau berhenti; exit 2 = ada temuan (default `--fail-on`);
 *   exit 1 = error. Status run ada di `run.json` (`completed` hanya bila agen menyelesaikan run).
 * - Target `localhost` dialihkan ke `host.docker.internal` oleh Strix (rewrite_localhost_targets).
 *
 * Exit code saja TIDAK dianggap bukti: status run dan isi artefak dibaca dan dicocokkan.
 */

export const STRIX_PINNED_VERSION = '1.7.0';
export const STRIX_SANDBOX_IMAGE = 'ghcr.io/usestrix/strix-sandbox:1.3.0';
export const STRIX_MAX_OUTPUT_BYTES = 256 * 1024;
/** Batas artefak: jumlah kandidat run, ukuran run.json, ukuran vulnerabilities.json. */
export const STRIX_MAX_RUN_CANDIDATES = 100;
export const STRIX_MAX_RUN_JSON_BYTES = 1 * 1024 * 1024;
export const STRIX_MAX_VULN_JSON_BYTES = 5 * 1024 * 1024;
const KILL_GRACE_MS = 10_000;

export type StrixScanMode = 'quick' | 'standard' | 'deep';

export type StrixRunOptions = {
  readonly bin: string;
  readonly target: string;
  readonly scanMode: StrixScanMode;
  readonly maxBudgetUsd: number;
  readonly maxTurns: number;
  /** Route model lengkap, mis. `gemini/gemini-3.8-flash`. */
  readonly llmRoute: string;
  readonly apiKey: string;
  readonly timeoutMs: number;
  readonly signal: AbortSignal;
};

export type StrixProcessResult = {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly durationMs: number;
  /** Keluaran terakhir yang SUDAH diredaksi. Hanya untuk log, tidak pernah masuk ke hasil modul. */
  readonly outputTail: string;
  readonly runDir: string | null;
  readonly runStatus: string | null;
  readonly findings: readonly StrixFinding[];
  readonly parseError: string | null;
};

export type StrixFinding = {
  readonly id: string;
  readonly title: string;
  readonly severity: string;
  readonly description: string | null;
  readonly impact: string | null;
  readonly remediation: string | null;
};

const RunRecordSchema = z.looseObject({
  status: z.string().min(1),
});

const VulnerabilitySchema = z.looseObject({
  id: z.string().min(1).max(200),
  title: z.string().min(1).max(500),
  severity: z.string().min(1).max(50),
  description: z.string().optional(),
  impact: z.string().optional(),
  remediation_steps: z.string().optional(),
});
const VulnerabilityListSchema = z.array(VulnerabilitySchema);

/** Argumen CLI non-interaktif. Tidak ada flag persetujuan interaktif; batas biaya dan giliran wajib. */
export function buildStrixArgs(opts: {
  readonly target: string;
  readonly scanMode: StrixScanMode;
  readonly maxBudgetUsd: number;
  readonly maxTurns: number;
}): string[] {
  return [
    '--non-interactive',
    '--target',
    opts.target,
    '--scan-mode',
    opts.scanMode,
    '--max-budget-usd',
    String(opts.maxBudgetUsd),
    '--max-turns',
    String(opts.maxTurns),
  ];
}

/**
 * Environment minimal. Hanya PATH dan DOCKER_HOST yang diteruskan dari proses induk; kunci hanya
 * lewat LLM_API_KEY. HOME diarahkan ke direktori kerja sementara agar konfigurasi pengguna tidak
 * terbaca.
 */
export function buildStrixEnv(opts: {
  readonly homeDir: string;
  readonly llmRoute: string;
  readonly apiKey: string;
  readonly parentEnv: NodeJS.ProcessEnv;
}): Record<string, string> {
  const env: Record<string, string> = {
    PATH: opts.parentEnv['PATH'] ?? '',
    HOME: opts.homeDir,
    LANG: 'C.UTF-8',
    STRIX_TELEMETRY: 'false',
    STRIX_NO_UPDATE_CHECK: '1',
    STRIX_LLM: opts.llmRoute,
    LLM_API_KEY: opts.apiKey,
  };
  if (opts.parentEnv['DOCKER_HOST']) env['DOCKER_HOST'] = opts.parentEnv['DOCKER_HOST'];
  return env;
}

function redactOutput(text: string, apiKey: string): string {
  let out = redactText(text);
  if (apiKey.length > 0) out = out.split(apiKey).join('[REDACTED:provider-key]');
  return out;
}

/** Menjalankan Strix dengan timeout dan pembatalan. Membunuh seluruh process group. */
export async function runStrixProcess(opts: StrixRunOptions): Promise<StrixProcessResult> {
  const workDir = mkdtempSync(path.join(tmpdir(), 'nwb-strix-run-'));
  const started = Date.now();
  try {
    const args = buildStrixArgs(opts);
    const env = buildStrixEnv({
      homeDir: workDir,
      llmRoute: opts.llmRoute,
      apiKey: opts.apiKey,
      parentEnv: process.env,
    });
    const exec = await execute(opts.bin, args, env, workDir, opts.timeoutMs, opts.signal);
    const outputTail = redactOutput(exec.output, opts.apiKey);
    const artifacts = readRunArtifacts(workDir);
    return {
      exitCode: exec.exitCode,
      signal: exec.signal,
      timedOut: exec.timedOut,
      cancelled: exec.cancelled,
      durationMs: Date.now() - started,
      outputTail,
      runDir: artifacts.runDir,
      runStatus: artifacts.runStatus,
      findings: artifacts.findings,
      parseError: artifacts.parseError,
    };
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

type ExecResult = {
  exitCode: number | null;
  signal: string | null;
  timedOut: boolean;
  cancelled: boolean;
  output: string;
};

function execute(
  bin: string,
  args: readonly string[],
  env: Record<string, string>,
  cwd: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, [...args], {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const append = (chunk: Buffer): void => {
      output += chunk.toString('utf8');
      if (output.length > STRIX_MAX_OUTPUT_BYTES)
        output = output.slice(output.length - STRIX_MAX_OUTPUT_BYTES);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);

    let timedOut = false;
    let cancelled = false;
    let killTimer: NodeJS.Timeout | undefined;
    const killGroup = (sig: NodeJS.Signals): void => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, sig);
      } catch {
        // Proses sudah keluar.
      }
    };
    const terminate = (): void => {
      killGroup('SIGTERM');
      killTimer = setTimeout(() => killGroup('SIGKILL'), KILL_GRACE_MS);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    const onAbort = (): void => {
      cancelled = true;
      terminate();
    };
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });

    const cleanup = (): void => {
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      signal.removeEventListener('abort', onAbort);
    };
    child.once('error', (err) => {
      cleanup();
      reject(err);
    });
    child.once('close', (code, sig) => {
      cleanup();
      resolve({ exitCode: code, signal: sig, timedOut, cancelled, output });
    });
  });
}

type RunArtifacts = {
  runDir: string | null;
  runStatus: string | null;
  findings: StrixFinding[];
  parseError: string | null;
};

/**
 * Membaca artefak run dari direktori kerja. Setiap kegagalan parse dilaporkan, tidak diabaikan.
 *
 * Keamanan (Fase 2):
 * - Symlink tidak diikuti: kandidat run dan file artefak yang berupa symlink ditolak.
 * - Path run tervalidasi berada di dalam workDir (realpath).
 * - Jumlah kandidat dibatasi (STRIX_MAX_RUN_CANDIDATES) sebelum stat/sort.
 * - Ukuran file dibatasi sebelum dibaca (STRIX_MAX_RUN_JSON_BYTES / STRIX_MAX_VULN_JSON_BYTES).
 * - TOCTOU (file hilang di tengah jalan) menghasilkan parseError, bukan crash.
 */
export function readRunArtifacts(workDir: string): RunArtifacts {
  let realWorkDir: string;
  try {
    realWorkDir = realpathSync(workDir);
  } catch {
    return { runDir: null, runStatus: null, findings: [], parseError: 'workdir-invalid' };
  }
  const runsRoot = path.join(realWorkDir, 'strix_runs');
  let names: string[];
  try {
    const lst = lstatSync(runsRoot);
    if (lst.isSymbolicLink() || !lst.isDirectory()) {
      return { runDir: null, runStatus: null, findings: [], parseError: 'strix-runs-missing' };
    }
    names = readdirSync(runsRoot);
  } catch {
    return { runDir: null, runStatus: null, findings: [], parseError: 'strix-runs-missing' };
  }
  if (names.length > STRIX_MAX_RUN_CANDIDATES) {
    return { runDir: null, runStatus: null, findings: [], parseError: 'too-many-candidates' };
  }
  type Candidate = { dir: string; mtimeMs: number };
  const candidates: Candidate[] = [];
  for (const name of names) {
    if (name === '.' || name === '..' || name.includes(path.sep)) continue;
    const p = path.join(runsRoot, name);
    let lst: ReturnType<typeof lstatSync>;
    try {
      lst = lstatSync(p);
    } catch {
      continue;
    }
    if (lst.isSymbolicLink()) continue;
    if (!lst.isDirectory()) continue;
    let real: string;
    try {
      real = realpathSync(p);
    } catch {
      continue;
    }
    if (real !== realWorkDir && !real.startsWith(realWorkDir + path.sep)) continue;
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(real).mtimeMs;
    } catch {
      continue;
    }
    candidates.push({ dir: real, mtimeMs });
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const runDir = candidates[0]?.dir;
  if (!runDir)
    return { runDir: null, runStatus: null, findings: [], parseError: 'run-dir-missing' };

  const readBoundedFile = (
    filePath: string,
    maxBytes: number,
  ): { ok: true; text: string } | { ok: false; error: string } => {
    let lst: ReturnType<typeof lstatSync>;
    try {
      lst = lstatSync(filePath);
    } catch {
      return { ok: false, error: 'missing' };
    }
    if (lst.isSymbolicLink()) return { ok: false, error: 'symlink-refused' };
    if (!lst.isFile()) return { ok: false, error: 'not-a-file' };
    if (lst.size > maxBytes) return { ok: false, error: 'too-large' };
    try {
      return { ok: true, text: readFileSync(filePath, 'utf8') };
    } catch {
      return { ok: false, error: 'unreadable' };
    }
  };

  const recordPath = path.join(runDir, 'run.json');
  const recordRead = readBoundedFile(recordPath, STRIX_MAX_RUN_JSON_BYTES);
  if (!recordRead.ok) {
    if (recordRead.error === 'missing') {
      return { runDir, runStatus: null, findings: [], parseError: 'run-json-missing' };
    }
    return { runDir, runStatus: null, findings: [], parseError: 'run-json-invalid' };
  }
  let runStatus: string;
  try {
    const record = RunRecordSchema.parse(JSON.parse(recordRead.text));
    runStatus = record.status;
  } catch {
    return { runDir, runStatus: null, findings: [], parseError: 'run-json-invalid' };
  }

  const vulnPath = path.join(runDir, 'vulnerabilities.json');
  const vulnRead = readBoundedFile(vulnPath, STRIX_MAX_VULN_JSON_BYTES);
  if (!vulnRead.ok) {
    if (vulnRead.error === 'missing') {
      return { runDir, runStatus, findings: [], parseError: null };
    }
    return { runDir, runStatus, findings: [], parseError: 'vulnerabilities-json-invalid' };
  }
  try {
    const list = VulnerabilityListSchema.parse(JSON.parse(vulnRead.text));
    return {
      runDir,
      runStatus,
      findings: list.map((v) => ({
        id: v.id,
        title: v.title,
        severity: v.severity,
        description: v.description ?? null,
        impact: v.impact ?? null,
        remediation: v.remediation_steps ?? null,
      })),
      parseError: null,
    };
  } catch {
    return { runDir, runStatus, findings: [], parseError: 'vulnerabilities-json-invalid' };
  }
}

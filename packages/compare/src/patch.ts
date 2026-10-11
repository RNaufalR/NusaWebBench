import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppError, redactText } from '@nusawebbench/core';

/**
 * Proposal patch lewat git worktree SEMENTARA (taskbook T-170). Tidak pernah menulis ke repository
 * pengguna: perubahan hanya ada di worktree terpisah, menghasilkan diff untuk ditinjau manusia.
 * Tidak ada merge, commit ke branch pengguna, atau deploy.
 */

const execFileAsync = promisify(execFile);
const SECRET_PATTERNS: readonly RegExp[] = [
  /AIza[0-9A-Za-z_-]{35}/,
  /gsk_[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bgh[pousr]_[A-Za-z0-9]{36,}/,
];

export type ProposedFile = { readonly path: string; readonly content: string };

export type PatchProposal = {
  readonly worktreePath: string;
  readonly baseRevision: string;
  readonly changedFiles: readonly string[];
  readonly diff: string;
  /** Membatalkan worktree sementara. Repository pengguna tidak tersentuh. */
  readonly rollback: () => Promise<void>;
};

export function isSafeRelativePath(p: string): boolean {
  if (p === '' || p.length > 200) return false;
  if (path.isAbsolute(p) || p.startsWith('/') || p.includes('\\')) return false;
  const parts = p.split('/');
  return parts.every((seg) => seg !== '' && seg !== '.' && seg !== '..' && seg !== '.git');
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: 60_000,
    env: { PATH: process.env['PATH'] ?? '', HOME: tmpdir(), GIT_TERMINAL_PROMPT: '0' },
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

/**
 * Membuat proposal patch. Menolak: repository kotor (perubahan pengguna belum di-commit), path di luar
 * akar repo, revisi dasar yang tidak ada, dan diff yang memuat pola rahasia.
 */
export async function proposePatch(input: {
  readonly repoPath: string;
  readonly baseRevision: string;
  readonly files: readonly ProposedFile[];
}): Promise<PatchProposal> {
  if (!/^[0-9a-f]{7,40}$/.test(input.baseRevision)) {
    throw new AppError('VALIDATION_FAILED', { safeMessage: 'Revisi dasar tidak valid.' });
  }
  for (const f of input.files) {
    if (!isSafeRelativePath(f.path))
      throw new AppError('VALIDATION_FAILED', {
        safeMessage: 'Path patch di luar akar repository.',
      });
  }
  // Repository pengguna harus bersih.
  let status: string;
  try {
    status = await git(input.repoPath, ['status', '--porcelain']);
  } catch {
    throw new AppError('TOOL_FAILED', {
      safeMessage: 'Git tidak tersedia atau repository tidak valid.',
    });
  }
  if (status.trim() !== '') {
    throw new AppError('CONFLICT', {
      safeMessage: 'Repository memiliki perubahan belum di-commit; patch ditolak.',
    });
  }

  const worktreeRoot = mkdtempSync(path.join(tmpdir(), 'nwb-wt-'));
  const worktreePath = path.join(worktreeRoot, 'wt');
  const rollback = async (): Promise<void> => {
    try {
      await git(input.repoPath, ['worktree', 'remove', '--force', worktreePath]);
    } catch {
      // worktree mungkin belum terdaftar; lanjut ke pembersihan direktori
    }
    await git(input.repoPath, ['worktree', 'prune']).catch(() => undefined);
    rmSync(worktreeRoot, { recursive: true, force: true });
  };

  try {
    try {
      await git(input.repoPath, ['worktree', 'add', '--detach', worktreePath, input.baseRevision]);
    } catch {
      rmSync(worktreeRoot, { recursive: true, force: true });
      throw new AppError('TOOL_FAILED', { safeMessage: 'Gagal membuat worktree sementara.' });
    }
    for (const f of input.files) {
      const abs = path.join(worktreePath, f.path);
      if (!abs.startsWith(worktreePath + path.sep))
        throw new AppError('VALIDATION_FAILED', { safeMessage: 'Path patch di luar worktree.' });
      try {
        mkdirSync(path.dirname(abs), { recursive: true });
        writeFileSync(abs, f.content, 'utf8');
      } catch {
        // Penulisan sebagian: worktree dibuang seluruhnya oleh rollback di bawah.
        throw new AppError('TOOL_FAILED', { safeMessage: 'Gagal menulis patch ke worktree.' });
      }
    }
    await git(worktreePath, ['add', '-N', '--', ...input.files.map((f) => f.path)]);
    const diff = await git(worktreePath, ['diff', '--no-color']);
    if (SECRET_PATTERNS.some((re) => re.test(diff))) {
      throw new AppError('VALIDATION_FAILED', {
        safeMessage: 'Diff memuat pola rahasia; patch ditolak.',
      });
    }
    const changed = (await git(worktreePath, ['diff', '--name-only'])).split('\n').filter(Boolean);
    return {
      worktreePath,
      baseRevision: input.baseRevision,
      changedFiles: changed,
      diff,
      rollback,
    };
  } catch (err) {
    await rollback();
    throw err;
  }
}

export type PostPatchCheck = {
  /** Identifier stabil untuk laporan, misalnya `unit`. */
  readonly id: string;
  /** Argumen terstruktur (argv[0] = executable). Tidak pernah lewat shell. */
  readonly argv: readonly string[];
  /** Batas waktu; proses dibunuh (SIGKILL) bila terlampaui. Maksimum 600 detik. */
  readonly timeoutMs: number;
};

export type PostPatchCheckResult = {
  readonly id: string;
  readonly status: 'PASSED' | 'FAILED' | 'TIMEOUT' | 'ERROR';
  readonly exitCode: number | null;
  /** Ekor keluaran (maks 2000 karakter) yang sudah diredaksi. */
  readonly outputTail: string;
};

export type PostPatchReport = {
  /** PASSED hanya bila ada minimal satu cek dan semuanya PASSED. Selain itu NOT_VERIFIED. */
  readonly verdict: 'PASSED' | 'NOT_VERIFIED';
  readonly results: readonly PostPatchCheckResult[];
};

const MAX_CHECK_TIMEOUT_MS = 600_000;
const MAX_CHECKS = 10;
const OUTPUT_TAIL_CHARS = 2000;

export function isValidCheck(c: PostPatchCheck): boolean {
  return (
    /^[a-z][a-z0-9-]{0,31}$/.test(c.id) &&
    Array.isArray(c.argv) &&
    c.argv.length > 0 &&
    c.argv.length <= 20 &&
    c.argv.every(
      (a) => typeof a === 'string' && a.length > 0 && a.length <= 500 && !a.includes('\0'),
    ) &&
    Number.isInteger(c.timeoutMs) &&
    c.timeoutMs > 0 &&
    c.timeoutMs <= MAX_CHECK_TIMEOUT_MS
  );
}

/**
 * Menjalankan tes relevan di DALAM worktree sementara setelah patch (taskbook T-170 butir 7).
 * Tidak ada shell, lingkungan minimal tanpa rahasia, dan keluaran dipotong serta diredaksi.
 * Setiap cek yang gagal, timeout, error, atau tidak dijalankan membuat verdict NOT_VERIFIED.
 */
export async function runPostPatchChecks(
  proposal: PatchProposal,
  checks: readonly PostPatchCheck[],
): Promise<PostPatchReport> {
  return runChecksIn(proposal.worktreePath, checks);
}

async function runChecksIn(
  worktreePath: string,
  checks: readonly PostPatchCheck[],
): Promise<PostPatchReport> {
  if (checks.length === 0 || checks.length > MAX_CHECKS) {
    throw new AppError('VALIDATION_FAILED', {
      safeMessage: `Jumlah cek harus 1 sampai ${MAX_CHECKS}.`,
    });
  }
  const ids = new Set<string>();
  for (const c of checks) {
    if (!isValidCheck(c) || ids.has(c.id))
      throw new AppError('VALIDATION_FAILED', { safeMessage: 'Definisi cek tidak valid.' });
    ids.add(c.id);
  }
  const results: PostPatchCheckResult[] = [];
  for (const c of checks) {
    results.push(await runOneCheck(worktreePath, c));
  }
  const verdict =
    results.length > 0 && results.every((r) => r.status === 'PASSED') ? 'PASSED' : 'NOT_VERIFIED';
  return { verdict, results };
}

async function runOneCheck(cwd: string, c: PostPatchCheck): Promise<PostPatchCheckResult> {
  const [exe, ...args] = c.argv as [string, ...string[]];
  return new Promise<PostPatchCheckResult>((resolve) => {
    const child = execFile(
      exe,
      args,
      {
        cwd,
        timeout: c.timeoutMs,
        killSignal: 'SIGKILL',
        maxBuffer: 256 * 1024,
        env: { PATH: process.env['PATH'] ?? '', HOME: tmpdir(), CI: '1', GIT_TERMINAL_PROMPT: '0' },
        windowsHide: true,
      },
      (err, stdout, stderr) => {
        const out = redactText(`${stdout ?? ''}\n${stderr ?? ''}`).slice(-OUTPUT_TAIL_CHARS);
        if (!err) {
          resolve({ id: c.id, status: 'PASSED', exitCode: 0, outputTail: out });
          return;
        }
        const e = err as NodeJS.ErrnoException & { killed?: boolean; signal?: string | null };
        if (e.killed && e.signal === 'SIGKILL') {
          resolve({ id: c.id, status: 'TIMEOUT', exitCode: null, outputTail: out });
          return;
        }
        if (typeof err.code === 'number') {
          resolve({ id: c.id, status: 'FAILED', exitCode: err.code, outputTail: out });
          return;
        }
        // ENOENT (executable tidak ada), EACCES, dan kegagalan lain: alat tidak berjalan.
        resolve({ id: c.id, status: 'ERROR', exitCode: null, outputTail: out });
      },
    );
    child.on('error', () => undefined);
  });
}

/**
 * Menjalankan cek di REVISI DASAR (tanpa patch) lewat worktree sementara, sebagai baseline "sebelum".
 * Worktree selalu dibuang setelah selesai; repository pengguna tidak tersentuh.
 */
export async function runChecksAtBase(
  repoPath: string,
  baseRevision: string,
  checks: readonly PostPatchCheck[],
): Promise<PostPatchReport> {
  if (!/^[0-9a-f]{7,40}$/.test(baseRevision)) {
    throw new AppError('VALIDATION_FAILED', { safeMessage: 'Revisi dasar tidak valid.' });
  }
  const worktreeRoot = mkdtempSync(path.join(tmpdir(), 'nwb-base-'));
  const worktreePath = path.join(worktreeRoot, 'wt');
  try {
    try {
      await git(repoPath, ['worktree', 'add', '--detach', worktreePath, baseRevision]);
    } catch {
      throw new AppError('TOOL_FAILED', { safeMessage: 'Gagal membuat worktree baseline.' });
    }
    return await runChecksIn(worktreePath, checks);
  } finally {
    await git(repoPath, ['worktree', 'remove', '--force', worktreePath]).catch(() => undefined);
    await git(repoPath, ['worktree', 'prune']).catch(() => undefined);
    rmSync(worktreeRoot, { recursive: true, force: true });
  }
}

export type ProposalRecord = {
  readonly baseRevision: string;
  /** Repository harus bersih sebelum proposal dibuat (dicek di proposePatch). */
  readonly initialWorkingTreeClean: true;
  readonly changedFiles: readonly string[];
  readonly diffSha256: string;
  readonly testsBefore: PostPatchReport | null;
  readonly testsAfter: PostPatchReport;
  /** Proposal tidak pernah diterapkan otomatis. Persetujuan manusia belum diberikan. */
  readonly approval: 'PENDING';
  readonly applied: false;
};

export function buildProposalRecord(input: {
  readonly proposal: PatchProposal;
  readonly testsBefore: PostPatchReport | null;
  readonly testsAfter: PostPatchReport;
}): ProposalRecord {
  return {
    baseRevision: input.proposal.baseRevision,
    initialWorkingTreeClean: true,
    changedFiles: input.proposal.changedFiles,
    diffSha256: createHash('sha256').update(input.proposal.diff).digest('hex'),
    testsBefore: input.testsBefore,
    testsAfter: input.testsAfter,
    approval: 'PENDING',
    applied: false,
  };
}

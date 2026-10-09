import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { AppError } from '@nusawebbench/core';

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
      mkdirSync(path.dirname(abs), { recursive: true });
      writeFileSync(abs, f.content, 'utf8');
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

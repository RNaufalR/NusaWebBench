import { createHash } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { AppError, TERMINAL_RUN_STATUSES, type Evidence } from '@nusawebbench/core';
import type { ArtifactStore } from './artifacts.js';
import type { Store } from './store.js';

/**
 * Retention artefak (taskbook T-200). Aturan:
 * - Hanya berkas yang tercatat sebagai evidence dan berada di dalam artifact root yang dihapus.
 * - Run yang belum terminal (QUEUED/RUNNING) tidak pernah disentuh.
 * - Preview wajib dulu; apply hanya menerima planId yang sama dengan preview dan memverifikasi ulang
 *   setiap kandidat (metadata, sha256, status run, path) sebelum menghapus.
 * - Yang dihapus hanya BYTE berkas. Baris metadata evidence tetap sebagai jejak audit; pembacaan
 *   berikutnya gagal dengan aman (ARTIFACT_ERROR missing-file).
 * - Tidak ada penghapusan berkas di luar root, tidak ada symlink yang diikuti.
 */

export const RETENTION_MIN_DAYS = 1;
export const RETENTION_MAX_DAYS = 3650;
export const RETENTION_MAX_CANDIDATES = 500;

export type RetentionPolicy = { readonly maxAgeDays: number };

export type RetentionCandidate = {
  readonly evidenceId: string;
  readonly runId: string;
  readonly pathRelative: string;
  readonly sha256: string;
  readonly sizeBytes: number;
  readonly createdAt: string;
};

export type RetentionSkip = {
  readonly evidenceId: string;
  readonly reason:
    | 'run-active'
    | 'run-missing'
    | 'path-rejected'
    | 'file-missing'
    | 'delete-failed'
    | 'changed-since-preview';
};

export type RetentionPlan = {
  readonly planId: string;
  readonly generatedAt: string;
  readonly policy: RetentionPolicy;
  readonly cutoff: string;
  readonly candidates: readonly RetentionCandidate[];
  readonly skipped: readonly RetentionSkip[];
  readonly totalBytes: number;
  /** true bila jumlah kandidat mencapai batas; sisanya akan muncul di preview berikutnya. */
  readonly truncated: boolean;
};

export type RetentionResult = {
  readonly deleted: readonly string[];
  readonly skipped: readonly RetentionSkip[];
  readonly freedBytes: number;
};

const TERMINAL = new Set<string>(TERMINAL_RUN_STATUSES);

export function computePlanId(
  rootDir: string,
  policy: RetentionPolicy,
  candidates: readonly RetentionCandidate[],
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        rootDir,
        maxAgeDays: policy.maxAgeDays,
        candidates: candidates.map((c) => [c.evidenceId, c.pathRelative, c.sha256, c.sizeBytes]),
      }),
    )
    .digest('hex');
}

function isRunTerminal(store: Store, runId: string): 'terminal' | 'active' | 'missing' {
  const run = store.runs.get(runId);
  if (!run) return 'missing';
  return TERMINAL.has(run.status) ? 'terminal' : 'active';
}

/** Menyusun rencana retention tanpa menghapus apa pun. */
export function previewRetention(input: {
  readonly store: Store;
  readonly artifacts: ArtifactStore;
  readonly policy: RetentionPolicy;
  readonly now?: Date;
}): RetentionPlan {
  const { store, artifacts, policy } = input;
  if (
    !Number.isInteger(policy.maxAgeDays) ||
    policy.maxAgeDays < RETENTION_MIN_DAYS ||
    policy.maxAgeDays > RETENTION_MAX_DAYS
  ) {
    throw new AppError('VALIDATION_FAILED', { safeMessage: 'Umur retention di luar batas.' });
  }
  const now = input.now ?? new Date();
  const cutoff = new Date(now.getTime() - policy.maxAgeDays * 86_400_000).toISOString();
  // Ambil satu lebih banyak untuk mendeteksi pemotongan.
  const rows: Evidence[] = store.evidence.listCreatedBefore(cutoff, RETENTION_MAX_CANDIDATES + 1);
  const truncated = rows.length > RETENTION_MAX_CANDIDATES;
  const candidates: RetentionCandidate[] = [];
  const skipped: RetentionSkip[] = [];
  let totalBytes = 0;

  for (const ev of rows.slice(0, RETENTION_MAX_CANDIDATES)) {
    const state = isRunTerminal(store, ev.runId);
    if (state === 'missing') {
      skipped.push({ evidenceId: ev.id, reason: 'run-missing' });
      continue;
    }
    if (state === 'active') {
      skipped.push({ evidenceId: ev.id, reason: 'run-active' });
      continue;
    }
    try {
      artifacts.resolveExisting(ev.pathRelative);
    } catch (err) {
      const debug = err instanceof AppError ? err.debugDetail : undefined;
      const reason = debug === 'missing-file' ? 'file-missing' : 'path-rejected';
      skipped.push({ evidenceId: ev.id, reason });
      continue;
    }
    candidates.push({
      evidenceId: ev.id,
      runId: ev.runId,
      pathRelative: ev.pathRelative,
      sha256: ev.sha256,
      sizeBytes: ev.sizeBytes,
      createdAt: ev.createdAt,
    });
    totalBytes += ev.sizeBytes;
  }

  return {
    planId: computePlanId(artifacts.rootDir, policy, candidates),
    generatedAt: now.toISOString(),
    policy,
    cutoff,
    candidates,
    skipped,
    totalBytes,
    truncated,
  };
}

/**
 * Menghapus berkas sesuai rencana. Menolak bila planId tidak cocok (rencana diubah) atau konfirmasi
 * tidak sama dengan planId. Setiap kandidat diverifikasi ulang sebelum dihapus.
 */
export function applyRetention(input: {
  readonly store: Store;
  readonly artifacts: ArtifactStore;
  readonly plan: RetentionPlan;
  readonly confirmPlanId: string;
}): RetentionResult {
  const { store, artifacts, plan } = input;
  if (input.confirmPlanId !== plan.planId) {
    throw new AppError('VALIDATION_FAILED', {
      safeMessage: 'Konfirmasi tidak cocok dengan rencana retention.',
    });
  }
  if (computePlanId(artifacts.rootDir, plan.policy, plan.candidates) !== plan.planId) {
    throw new AppError('VALIDATION_FAILED', { safeMessage: 'Rencana retention tidak valid.' });
  }
  const deleted: string[] = [];
  const skipped: RetentionSkip[] = [];
  let freedBytes = 0;

  for (const c of plan.candidates) {
    const ev = store.evidence.get(c.evidenceId);
    if (!ev || ev.pathRelative !== c.pathRelative || ev.sha256 !== c.sha256) {
      skipped.push({ evidenceId: c.evidenceId, reason: 'changed-since-preview' });
      continue;
    }
    const state = isRunTerminal(store, c.runId);
    if (state !== 'terminal') {
      skipped.push({
        evidenceId: c.evidenceId,
        reason: state === 'missing' ? 'run-missing' : 'run-active',
      });
      continue;
    }
    let abs: string;
    try {
      abs = artifacts.resolveExisting(c.pathRelative);
    } catch (err) {
      const debug = err instanceof AppError ? err.debugDetail : undefined;
      skipped.push({
        evidenceId: c.evidenceId,
        reason: debug === 'missing-file' ? 'file-missing' : 'path-rejected',
      });
      continue;
    }
    try {
      unlinkSync(abs);
    } catch {
      skipped.push({ evidenceId: c.evidenceId, reason: 'delete-failed' });
      continue;
    }
    deleted.push(c.evidenceId);
    freedBytes += c.sizeBytes;
  }

  return { deleted, skipped, freedBytes };
}

import type { ModuleName, ModuleStatus, RunStatus } from '@nusawebbench/core';

/** Status modul yang menandakan modul benar-benar dijalankan dan menghasilkan hasil. */
const EXECUTED: readonly ModuleStatus[] = ['PASS', 'FAIL', 'WARN'];

export type ModuleOutcomeInput = {
  readonly module: ModuleName;
  readonly status: ModuleStatus;
  readonly required: boolean;
};

/**
 * Agregasi status run (taskbook §6.2). Aturan:
 * - cancel diminta → CANCELLED (transisi akhir dilakukan orchestrator);
 * - semua modul wajib dijalankan dan modul opsional yang dimatikan `SKIPPED` → COMPLETED;
 * - sebagian hasil ada, tetapi ada modul wajib gagal atau modul opsional gagal → PARTIAL;
 * - tidak ada hasil sama sekali → FAILED.
 * Modul `UNAVAILABLE`, `ERROR`, `NOT_RUN`, dan `CANCELLED` tidak pernah dihitung sebagai berhasil.
 */
export function aggregateRunStatus(input: {
  readonly cancelRequested: boolean;
  readonly modules: readonly ModuleOutcomeInput[];
}): Extract<RunStatus, 'CANCELLED' | 'COMPLETED' | 'PARTIAL' | 'FAILED'> {
  if (input.cancelRequested) return 'CANCELLED';
  if (input.modules.length === 0) return 'FAILED';

  let anyExecuted = false;
  let allRequiredExecuted = true;
  let anyUnhealthyOptional = false;
  for (const m of input.modules) {
    const executed = EXECUTED.includes(m.status);
    if (executed) anyExecuted = true;
    if (m.required && !executed) allRequiredExecuted = false;
    if (!m.required && !executed && m.status !== 'SKIPPED') anyUnhealthyOptional = true;
  }
  if (!anyExecuted) return 'FAILED';
  if (allRequiredExecuted && !anyUnhealthyOptional) return 'COMPLETED';
  return 'PARTIAL';
}

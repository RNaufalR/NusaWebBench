import { createHash } from 'node:crypto';
import {
  AppError,
  ALLOWED_RUN_TRANSITIONS,
  FindingSchema,
  EvidenceSchema,
  ModuleResultSchema,
  ProviderUsageSchema,
  RemediationProposalSchema,
  RunSchema,
  TargetSchema,
  isAllowedRunTransition,
  newId,
  parseOrThrow,
  type SafeParser,
  type Evidence,
  type Finding,
  type ModuleResult,
  type ProviderUsage,
  type RemediationProposal,
  type Run,
  type RunStatus,
  type Target,
  type Provider,
} from '@nusawebbench/core';
import { type Db, mapSqliteError, withTransaction } from './database.js';

/**
 * Repository layer. Semua query memakai parameter `?` (tidak ada concatenation input).
 * Nama tabel/kolom berasal dari kode, bukan dari input pengguna. Setiap baris yang dibaca dari
 * database divalidasi ulang dengan schema domain; baris rusak menghasilkan STORAGE_ERROR.
 */

type Row = Record<string, unknown>;

function parseStored<T>(schema: SafeParser<T>, json: unknown, label: string, id: string): T {
  if (typeof json !== 'string') {
    throw new AppError('STORAGE_ERROR', { debugDetail: `${label} ${id}: data_json bukan string` });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new AppError('STORAGE_ERROR', { debugDetail: `${label} ${id}: JSON rusak` });
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new AppError('STORAGE_ERROR', {
      safeMessage: 'Data tersimpan tidak valid dan tidak dapat dibaca.',
      debugDetail: `${label} ${id}: schema mismatch`,
    });
  }
  return result.data;
}

function clampLimit(limit: number | undefined, fallback: number, max: number): number {
  if (limit === undefined) return fallback;
  if (!Number.isInteger(limit) || limit < 1 || limit > max) {
    throw new AppError('VALIDATION_FAILED', { safeMessage: 'Batas jumlah data tidak valid.' });
  }
  return limit;
}

// ---------- Targets ----------

export class TargetRepository {
  constructor(private readonly db: Db) {}

  insert(target: Target): void {
    const data = parseOrThrow(TargetSchema, target, 'Target');
    try {
      this.db
        .prepare(
          'INSERT INTO targets (id, origin, mode, created_at, updated_at, data_json) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(data.id, data.origin, data.mode, data.createdAt, data.updatedAt, JSON.stringify(data));
    } catch (err) {
      throw mapSqliteError(err);
    }
  }

  get(id: string): Target | null {
    const row = this.db.prepare('SELECT data_json FROM targets WHERE id = ?').get(id) as
      Row | undefined;
    return row ? parseStored(TargetSchema, row['data_json'], 'target', id) : null;
  }

  findByOrigin(origin: string): Target | null {
    const row = this.db
      .prepare('SELECT data_json, id FROM targets WHERE origin = ?')
      .get(origin) as Row | undefined;
    return row ? parseStored(TargetSchema, row['data_json'], 'target', String(row['id'])) : null;
  }

  list(limit?: number): Target[] {
    const rows = this.db
      .prepare('SELECT id, data_json FROM targets ORDER BY created_at DESC, id DESC LIMIT ?')
      .all(clampLimit(limit, 50, 500)) as Row[];
    return rows.map((r) => parseStored(TargetSchema, r['data_json'], 'target', String(r['id'])));
  }
}

// ---------- Runs ----------

export class RunRepository {
  constructor(private readonly db: Db) {}

  /** Menyimpan run baru. moduleResults disimpan terpisah; field itu harus kosong saat insert. */
  insert(run: Run): void {
    const data = parseOrThrow(RunSchema, run, 'Run');
    if (
      data.moduleResults.length > 0 ||
      data.findingIds.length > 0 ||
      data.artifactRefs.length > 0
    ) {
      throw new AppError('VALIDATION_FAILED', {
        safeMessage: 'Run baru tidak boleh memuat hasil.',
        debugDetail: 'insert run with children',
      });
    }
    try {
      withTransaction(this.db, () => {
        this.db
          .prepare(
            'INSERT INTO runs (id, target_id, status, created_at, version, data_json) VALUES (?, ?, ?, ?, 0, ?)',
          )
          .run(data.id, data.targetId, data.status, data.createdAt, JSON.stringify(data));
        this.db
          .prepare(
            'INSERT INTO run_transitions (id, run_id, from_status, to_status, at, reason) VALUES (?, ?, NULL, ?, ?, ?)',
          )
          .run(newId('transition'), data.id, data.status, data.createdAt, 'created');
      });
    } catch (err) {
      throw mapSqliteError(err);
    }
  }

  get(id: string): Run | null {
    const row = this.db.prepare('SELECT data_json FROM runs WHERE id = ?').get(id) as
      Row | undefined;
    if (!row) return null;
    const stored = parseStored(RunSchema, row['data_json'], 'run', id);
    // Kolom moduleResults di data_json selalu kosong; hasil modul dimuat dari tabel module_results.
    return parseOrThrow(RunSchema, { ...stored, moduleResults: this.modulesFor(id) }, 'Run');
  }

  list(options: { status?: RunStatus; limit?: number } = {}): Run[] {
    const limit = clampLimit(options.limit, 20, 200);
    const rows = (
      options.status
        ? this.db
            .prepare(
              'SELECT id FROM runs WHERE status = ? ORDER BY created_at DESC, id DESC LIMIT ?',
            )
            .all(options.status, limit)
        : this.db
            .prepare('SELECT id FROM runs ORDER BY created_at DESC, id DESC LIMIT ?')
            .all(limit)
    ) as Row[];
    return rows.map((r) => this.get(String(r['id']))).filter((r): r is Run => r !== null);
  }

  /** Versi CAS saat ini, atau null bila run tidak ada. */
  version(id: string): number | null {
    const row = this.db.prepare('SELECT version FROM runs WHERE id = ?').get(id) as Row | undefined;
    return row ? Number(row['version']) : null;
  }

  /**
   * Transisi status dengan compare-and-set: hanya berhasil jika status masih `from` dan versi cocok.
   * Transisi yang tidak diizinkan oleh ALLOWED_RUN_TRANSITIONS ditolak.
   */
  transition(
    id: string,
    to: RunStatus,
    options: {
      expectedVersion: number;
      at: string;
      reason: string;
      patch?: Partial<Pick<Run, 'startedAt' | 'completedAt' | 'errorSummary'>>;
    },
  ): Run {
    return withTransaction(this.db, () => {
      const row = this.db
        .prepare('SELECT status, version, data_json FROM runs WHERE id = ?')
        .get(id) as Row | undefined;
      if (!row) {
        throw new AppError('NOT_FOUND');
      }
      const from = String(row['status']) as RunStatus;
      const version = Number(row['version']);
      if (version !== options.expectedVersion) {
        throw new AppError('CONFLICT', {
          safeMessage: 'Status run telah berubah. Muat ulang lalu coba lagi.',
        });
      }
      if (!isAllowedRunTransition(from, to)) {
        throw new AppError('CONFLICT', {
          safeMessage: 'Perubahan status run tidak diizinkan.',
          debugDetail: `transition ${from} -> ${to} not allowed (allowed: ${ALLOWED_RUN_TRANSITIONS[from].join(',') || 'none'})`,
        });
      }
      const current = parseStored(RunSchema, row['data_json'], 'run', id);
      // Hanya field berikut yang boleh diubah lewat transisi. Identitas (id, target, createdAt)
      // tidak pernah berasal dari patch, bahkan jika pemanggil melewati batas tipe TypeScript.
      const allowedPatch: Partial<Pick<Run, 'startedAt' | 'completedAt' | 'errorSummary'>> = {};
      const patch = options.patch ?? {};
      if ('startedAt' in patch) allowedPatch.startedAt = patch.startedAt ?? null;
      if ('completedAt' in patch) allowedPatch.completedAt = patch.completedAt ?? null;
      if ('errorSummary' in patch) allowedPatch.errorSummary = patch.errorSummary ?? null;
      const next = parseOrThrow(
        RunSchema,
        {
          ...current,
          moduleResults: [],
          ...allowedPatch,
          status: to,
        },
        'Run',
      );
      const update = this.db
        .prepare(
          'UPDATE runs SET status = ?, version = version + 1, data_json = ? WHERE id = ? AND version = ?',
        )
        .run(to, JSON.stringify(next), id, options.expectedVersion);
      if (Number(update.changes) !== 1) {
        throw new AppError('CONFLICT', {
          safeMessage: 'Status run telah berubah. Muat ulang lalu coba lagi.',
        });
      }
      this.db
        .prepare(
          'INSERT INTO run_transitions (id, run_id, from_status, to_status, at, reason) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(newId('transition'), id, from, to, options.at, options.reason.slice(0, 300));
      return this.get(id) as Run;
    });
  }

  transitionsFor(
    runId: string,
  ): Array<{ from: string | null; to: string; at: string; reason: string | null }> {
    const rows = this.db
      .prepare(
        'SELECT from_status, to_status, at, reason FROM run_transitions WHERE run_id = ? ORDER BY at, rowid',
      )
      .all(runId) as Row[];
    return rows.map((r) => ({
      from: r['from_status'] === null ? null : String(r['from_status']),
      to: String(r['to_status']),
      at: String(r['at']),
      reason: r['reason'] === null ? null : String(r['reason']),
    }));
  }

  private modulesFor(runId: string): ModuleResult[] {
    const rows = this.db
      .prepare('SELECT id, data_json FROM module_results WHERE run_id = ? ORDER BY created_at, id')
      .all(runId) as Row[];
    return rows.map((r) =>
      parseStored(ModuleResultSchema, r['data_json'], 'module', String(r['id'])),
    );
  }
}

// ---------- Module results ----------

export class ModuleResultRepository {
  constructor(private readonly db: Db) {}

  insert(module: ModuleResult): void {
    const data = parseOrThrow(ModuleResultSchema, module, 'ModuleResult');
    try {
      this.db
        .prepare(
          'INSERT INTO module_results (id, run_id, module, created_at, data_json) VALUES (?, ?, ?, ?, ?)',
        )
        .run(data.id, data.runId, data.module, new Date().toISOString(), JSON.stringify(data));
    } catch (err) {
      throw mapSqliteError(err);
    }
  }

  /** Mengganti data modul (status/metrik/error). Tidak dapat mengubah run_id atau module. */
  update(module: ModuleResult): void {
    const data = parseOrThrow(ModuleResultSchema, module, 'ModuleResult');
    const row = this.db
      .prepare('SELECT run_id, module FROM module_results WHERE id = ?')
      .get(data.id) as Row | undefined;
    if (!row) throw new AppError('NOT_FOUND');
    if (String(row['run_id']) !== data.runId || String(row['module']) !== data.module) {
      throw new AppError('FORBIDDEN', { debugDetail: 'module identity change rejected' });
    }
    this.db
      .prepare('UPDATE module_results SET data_json = ? WHERE id = ?')
      .run(JSON.stringify(data), data.id);
  }

  listByRun(runId: string): ModuleResult[] {
    const rows = this.db
      .prepare('SELECT id, data_json FROM module_results WHERE run_id = ? ORDER BY created_at, id')
      .all(runId) as Row[];
    return rows.map((r) =>
      parseStored(ModuleResultSchema, r['data_json'], 'module', String(r['id'])),
    );
  }
}

// ---------- Findings ----------

/** Sidik jari temuan untuk deduplikasi per run (rule, URL, selector, kategori, judul). */
export function fingerprintOf(
  f: Pick<Finding, 'ruleId' | 'targetUrl' | 'selector' | 'category' | 'title'>,
): string {
  return createHash('sha256')
    .update(JSON.stringify([f.ruleId, f.targetUrl, f.selector, f.category, f.title]))
    .digest('hex');
}

export class FindingRepository {
  constructor(private readonly db: Db) {}

  /**
   * Menyimpan temuan bila belum ada dengan sidik jari yang sama dalam run.
   * @returns true jika baru disimpan, false jika duplikat (idempotent)
   */
  insertIfNew(finding: Finding): boolean {
    const data = parseOrThrow(FindingSchema, finding, 'Finding');
    try {
      const result = this.db
        .prepare(
          `INSERT INTO findings (id, run_id, module_result_id, fingerprint, created_at, data_json)
           VALUES (?, ?, ?, ?, ?, ?)
           ON CONFLICT (run_id, fingerprint) DO NOTHING`,
        )
        .run(
          data.id,
          data.runId,
          data.moduleResultId,
          fingerprintOf(data),
          data.createdAt,
          JSON.stringify(data),
        );
      return Number(result.changes) === 1;
    } catch (err) {
      throw mapSqliteError(err);
    }
  }

  listByRun(
    runId: string,
    options: { limit?: number; offset?: number } = {},
  ): { items: Finding[]; total: number } {
    const limit = clampLimit(options.limit, 50, 500);
    const offset = Math.max(0, Math.floor(options.offset ?? 0));
    const total = Number(
      (this.db.prepare('SELECT COUNT(*) AS n FROM findings WHERE run_id = ?').get(runId) as Row)[
        'n'
      ],
    );
    const rows = this.db
      .prepare(
        'SELECT id, data_json FROM findings WHERE run_id = ? ORDER BY created_at, id LIMIT ? OFFSET ?',
      )
      .all(runId, limit, offset) as Row[];
    return {
      items: rows.map((r) =>
        parseStored(FindingSchema, r['data_json'], 'finding', String(r['id'])),
      ),
      total,
    };
  }
}

// ---------- Evidence ----------

export class EvidenceRepository {
  constructor(private readonly db: Db) {}

  insert(evidence: Evidence): void {
    const data = parseOrThrow(EvidenceSchema, evidence, 'Evidence');
    try {
      this.db
        .prepare(
          'INSERT INTO evidence (id, run_id, path_relative, sha256, created_at, data_json) VALUES (?, ?, ?, ?, ?, ?)',
        )
        .run(
          data.id,
          data.runId,
          data.pathRelative,
          data.sha256,
          data.createdAt,
          JSON.stringify(data),
        );
    } catch (err) {
      throw mapSqliteError(err);
    }
  }

  get(id: string): Evidence | null {
    const row = this.db.prepare('SELECT data_json FROM evidence WHERE id = ?').get(id) as
      Row | undefined;
    return row ? parseStored(EvidenceSchema, row['data_json'], 'evidence', id) : null;
  }

  /** Evidence yang dibuat sebelum batas waktu (untuk retention). Dibatasi jumlahnya. */
  listCreatedBefore(isoCutoff: string, limit: number): Evidence[] {
    const rows = this.db
      .prepare(
        'SELECT id, data_json FROM evidence WHERE created_at < ? ORDER BY created_at, id LIMIT ?',
      )
      .all(isoCutoff, Math.max(1, Math.min(limit, 1000))) as Row[];
    return rows.map((r) =>
      parseStored(EvidenceSchema, r['data_json'], 'evidence', String(r['id'])),
    );
  }

  listByRun(runId: string): Evidence[] {
    const rows = this.db
      .prepare('SELECT id, data_json FROM evidence WHERE run_id = ? ORDER BY created_at, id')
      .all(runId) as Row[];
    return rows.map((r) =>
      parseStored(EvidenceSchema, r['data_json'], 'evidence', String(r['id'])),
    );
  }
}

// ---------- Provider usage ----------

export class ProviderUsageRepository {
  constructor(private readonly db: Db) {}

  insert(usage: ProviderUsage): void {
    const data = parseOrThrow(ProviderUsageSchema, usage, 'ProviderUsage');
    try {
      this.db
        .prepare(
          `INSERT INTO provider_usage (id, run_id, provider, local_quota_bucket, recorded_at, status, data_json)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          data.id,
          data.runId,
          data.provider,
          data.localQuotaBucket,
          data.recordedAt,
          data.status,
          JSON.stringify(data),
        );
    } catch (err) {
      throw mapSqliteError(err);
    }
  }

  /**
   * Jumlah request lokal yang tercatat (status apa pun yang mengirim request ke provider) untuk
   * provider dan bucket (hari, YYYY-MM-DD). Ini hitungan penggunaan aplikasi lokal, bukan kuota akun.
   */
  countRequests(provider: Provider, bucket: string): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(json_extract(data_json, '$.requestCount')), 0) AS n
         FROM provider_usage WHERE provider = ? AND local_quota_bucket = ?`,
      )
      .get(provider, bucket) as Row;
    return Number(row['n']);
  }

  /**
   * Sama dengan countRequests, tetapi hanya baris yang dicatat pada atau setelah `sinceIso`.
   * Dipakai untuk "reset penghitung lokal": riwayat tetap ada, hanya baseline hitungan yang berubah.
   */
  countRequestsSince(provider: Provider, bucket: string, sinceIso: string | null): number {
    const row = this.db
      .prepare(
        `SELECT COALESCE(SUM(json_extract(data_json, '$.requestCount')), 0) AS n
         FROM provider_usage
         WHERE provider = ? AND local_quota_bucket = ? AND (? IS NULL OR recorded_at >= ?)`,
      )
      .get(provider, bucket, sinceIso, sinceIso) as Row;
    return Number(row['n']);
  }
  list(limit = 100): ProviderUsage[] {
    const rows = this.db
      .prepare(
        'SELECT id, data_json FROM provider_usage ORDER BY recorded_at DESC, id DESC LIMIT ?',
      )
      .all(clampLimit(limit, 100, 1000)) as Row[];
    return rows.map((r) =>
      parseStored(ProviderUsageSchema, r['data_json'], 'usage', String(r['id'])),
    );
  }
}

// ---------- Remediation ----------

export class RemediationRepository {
  constructor(private readonly db: Db) {}

  insert(proposal: RemediationProposal): void {
    const data = parseOrThrow(RemediationProposalSchema, proposal, 'RemediationProposal');
    try {
      this.db
        .prepare(
          'INSERT INTO remediation_proposals (id, status, created_at, data_json) VALUES (?, ?, ?, ?)',
        )
        .run(data.id, data.status, data.createdAt, JSON.stringify(data));
    } catch (err) {
      throw mapSqliteError(err);
    }
  }

  get(id: string): RemediationProposal | null {
    const row = this.db
      .prepare('SELECT data_json FROM remediation_proposals WHERE id = ?')
      .get(id) as Row | undefined;
    return row ? parseStored(RemediationProposalSchema, row['data_json'], 'remediation', id) : null;
  }
}

// ---------- App settings ----------

const SETTING_KEY = /^[a-z][a-z0-9_.-]{0,63}$/;

export class SettingsRepository {
  constructor(private readonly db: Db) {}

  set(key: string, value: string | number | boolean | null, now: Date = new Date()): void {
    if (!SETTING_KEY.test(key)) {
      throw new AppError('VALIDATION_FAILED', { safeMessage: 'Nama pengaturan tidak valid.' });
    }
    this.db
      .prepare(
        `INSERT INTO app_settings (key, value_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT (key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
      )
      .run(key, JSON.stringify(value), now.toISOString());
  }

  get(key: string): string | number | boolean | null | undefined {
    const row = this.db.prepare('SELECT value_json FROM app_settings WHERE key = ?').get(key) as
      Row | undefined;
    if (!row) return undefined;
    const parsed: unknown = JSON.parse(String(row['value_json']));
    if (
      parsed === null ||
      typeof parsed === 'string' ||
      typeof parsed === 'number' ||
      typeof parsed === 'boolean'
    ) {
      return parsed;
    }
    throw new AppError('STORAGE_ERROR', { debugDetail: `setting ${key} has unsupported shape` });
  }
}

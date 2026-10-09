import { createHash } from 'node:crypto';
import { AppError, MODULE_NAMES, RUN_STATUSES, TARGET_MODES } from '@nusawebbench/core';
import { type Db, withTransaction } from './database.js';

/**
 * Migrasi versioned. Aturan:
 * - Setiap migrasi immutable setelah dirilis; perubahan berarti migrasi baru.
 * - Checksum SHA-256 disimpan; jika migrasi yang sudah diterapkan berubah, startup gagal.
 * - Database dengan versi lebih tinggi dari aplikasi ditolak (tidak ada downgrade diam-diam).
 * - Setiap migrasi berjalan dalam transaksi; kegagalan melakukan rollback.
 */
export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

const statusList = RUN_STATUSES.map((s) => `'${s}'`).join(', ');
const modeList = TARGET_MODES.map((m) => `'${m}'`).join(', ');
const moduleList = MODULE_NAMES.map((m) => `'${m}'`).join(', ');

export const MIGRATIONS: readonly Migration[] = Object.freeze([
  {
    version: 1,
    name: 'initial-schema',
    sql: `
CREATE TABLE targets (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK (mode IN (${modeList})),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  data_json TEXT NOT NULL
) STRICT;

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  target_id TEXT NOT NULL REFERENCES targets(id) ON DELETE RESTRICT,
  status TEXT NOT NULL CHECK (status IN (${statusList})),
  created_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 0 CHECK (version >= 0),
  data_json TEXT NOT NULL
) STRICT;
CREATE INDEX runs_status_idx ON runs(status);
CREATE INDEX runs_target_idx ON runs(target_id);
CREATE INDEX runs_created_idx ON runs(created_at);

CREATE TABLE run_transitions (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL CHECK (to_status IN (${statusList})),
  at TEXT NOT NULL,
  reason TEXT
) STRICT;
CREATE INDEX run_transitions_run_idx ON run_transitions(run_id, at);

CREATE TABLE module_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  module TEXT NOT NULL CHECK (module IN (${moduleList})),
  created_at TEXT NOT NULL,
  data_json TEXT NOT NULL,
  UNIQUE (run_id, module)
) STRICT;

CREATE TABLE findings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  module_result_id TEXT NOT NULL REFERENCES module_results(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data_json TEXT NOT NULL,
  UNIQUE (run_id, fingerprint)
) STRICT;
CREATE INDEX findings_run_idx ON findings(run_id);

CREATE TABLE evidence (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  path_relative TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data_json TEXT NOT NULL,
  UNIQUE (run_id, path_relative)
) STRICT;
CREATE INDEX evidence_run_idx ON evidence(run_id);

CREATE TABLE provider_usage (
  id TEXT PRIMARY KEY,
  run_id TEXT REFERENCES runs(id) ON DELETE SET NULL,
  provider TEXT NOT NULL,
  local_quota_bucket TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  status TEXT NOT NULL,
  data_json TEXT NOT NULL
) STRICT;
CREATE INDEX provider_usage_bucket_idx ON provider_usage(provider, local_quota_bucket);

CREATE TABLE remediation_proposals (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data_json TEXT NOT NULL
) STRICT;

CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`,
  },
]);

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0);

export function checksumOf(migration: Migration): string {
  return createHash('sha256').update(migration.sql).digest('hex');
}

/**
 * Menerapkan semua migrasi yang belum ada. Idempotent: menjalankan ulang tidak mengubah apa pun.
 * @returns daftar versi yang baru diterapkan
 */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    checksum TEXT NOT NULL,
    applied_at TEXT NOT NULL
  ) STRICT;`);

  const applied = new Map<number, { name: string; checksum: string }>();
  for (const row of db.prepare('SELECT version, name, checksum FROM schema_migrations').all()) {
    const version = Number(row['version']);
    applied.set(version, { name: String(row['name']), checksum: String(row['checksum']) });
  }

  const known = new Map(migrations.map((m) => [m.version, m]));
  const maxKnown = Math.max(0, ...known.keys());
  for (const version of applied.keys()) {
    if (version > maxKnown) {
      throw new AppError('STORAGE_ERROR', {
        safeMessage: 'Database dibuat oleh versi aplikasi yang lebih baru.',
        debugDetail: `db version ${version} > app max ${maxKnown}`,
      });
    }
    const migration = known.get(version);
    const record = applied.get(version);
    if (!migration || !record || record.checksum !== checksumOf(migration)) {
      throw new AppError('STORAGE_ERROR', {
        safeMessage: 'Migrasi yang sudah diterapkan tidak cocok dengan versi aplikasi ini.',
        debugDetail: `checksum mismatch or missing migration v${version}`,
      });
    }
  }

  const newlyApplied: number[] = [];
  const ordered = [...migrations].sort((a, b) => a.version - b.version);
  for (const migration of ordered) {
    if (applied.has(migration.version)) continue;
    withTransaction(db, () => {
      db.exec(migration.sql);
      db.prepare(
        'INSERT INTO schema_migrations (version, name, checksum, applied_at) VALUES (?, ?, ?, ?)',
      ).run(migration.version, migration.name, checksumOf(migration), new Date().toISOString());
    });
    newlyApplied.push(migration.version);
  }
  return newlyApplied;
}

export function currentSchemaVersion(db: Db): number {
  const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM schema_migrations').get();
  return Number(row?.['v'] ?? 0);
}

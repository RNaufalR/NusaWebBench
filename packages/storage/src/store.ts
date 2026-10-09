import { AppError } from '@nusawebbench/core';
import { openDatabase, type Db } from './database.js';
import { migrate } from './migrations.js';
import {
  EvidenceRepository,
  FindingRepository,
  ModuleResultRepository,
  ProviderUsageRepository,
  RemediationRepository,
  RunRepository,
  SettingsRepository,
  TargetRepository,
} from './repositories.js';

/** Gabungan repository di atas satu koneksi. Dibuat sekali saat startup. */
export class Store {
  readonly db: Db;
  readonly targets: TargetRepository;
  readonly runs: RunRepository;
  readonly modules: ModuleResultRepository;
  readonly findings: FindingRepository;
  readonly evidence: EvidenceRepository;
  readonly usage: ProviderUsageRepository;
  readonly remediations: RemediationRepository;
  readonly settings: SettingsRepository;
  private closed = false;

  private constructor(db: Db) {
    this.db = db;
    this.targets = new TargetRepository(db);
    this.runs = new RunRepository(db);
    this.modules = new ModuleResultRepository(db);
    this.findings = new FindingRepository(db);
    this.evidence = new EvidenceRepository(db);
    this.usage = new ProviderUsageRepository(db);
    this.remediations = new RemediationRepository(db);
    this.settings = new SettingsRepository(db);
  }

  /** Membuka file database dan menerapkan migrasi. Gagal jika schema tidak cocok. */
  static open(filePath: string): Store {
    const db = openDatabase(filePath);
    try {
      migrate(db);
    } catch (err) {
      db.close();
      throw err instanceof AppError ? err : new AppError('STORAGE_ERROR', { cause: err });
    }
    return new Store(db);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.db.close();
  }
}

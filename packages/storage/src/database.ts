import { mkdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { AppError, redactText, type ErrorCode } from '@nusawebbench/core';

export type Db = DatabaseSync;

/**
 * Membuka database SQLite lokal dan menerapkan PRAGMA aman:
 * foreign keys aktif, WAL untuk file, busy timeout terbatas, synchronous NORMAL.
 * Kegagalan dipetakan ke AppError STORAGE_ERROR tanpa path atau pesan mentah.
 */
export function openDatabase(filePath: string): Db {
  if (filePath !== ':memory:') {
    const dir = path.dirname(path.resolve(filePath));
    try {
      mkdirSync(dir, { recursive: true });
      // Pastikan folder dapat ditulis sebelum membuka file.
      statSync(dir);
    } catch (err) {
      throw new AppError('STORAGE_ERROR', {
        safeMessage: 'Folder database tidak dapat dibuat atau diakses.',
        debugDetail: describe(err),
        cause: err,
      });
    }
  }
  let db: Db;
  try {
    db = new DatabaseSync(filePath);
  } catch (err) {
    throw new AppError('STORAGE_ERROR', {
      safeMessage: 'Database tidak dapat dibuka.',
      debugDetail: describe(err),
      cause: err,
    });
  }
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('PRAGMA busy_timeout = 5000;');
    if (filePath !== ':memory:') {
      db.exec('PRAGMA journal_mode = WAL;');
      db.exec('PRAGMA synchronous = NORMAL;');
    }
    // Memastikan file bukan database rusak: membaca metadata schema.
    db.prepare('SELECT count(*) AS n FROM sqlite_master').get();
    return db;
  } catch (err) {
    db.close();
    throw new AppError('STORAGE_ERROR', {
      safeMessage: 'Database rusak atau tidak dapat dibaca.',
      debugDetail: describe(err),
      cause: err,
    });
  }
}

/**
 * Menjalankan fn dalam satu transaksi IMMEDIATE. Error apa pun melakukan ROLLBACK dan dilempar ulang
 * dalam bentuk AppError yang dipetakan.
 */
export function withTransaction<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE;');
  try {
    const result = fn();
    db.exec('COMMIT;');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK;');
    } catch {
      // ROLLBACK gagal (mis. transaksi sudah berakhir). Error asli tetap dilempar.
    }
    throw mapSqliteError(err);
  }
}

/** Memetakan error SQLite ke taksonomi AppError. Pesan asli hanya masuk debugDetail (diredaksi). */
export function mapSqliteError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : '';
  let code: ErrorCode = 'STORAGE_ERROR';
  let safeMessage = 'Operasi penyimpanan gagal.';
  if (message.includes('UNIQUE constraint failed') || message.includes('PRIMARY KEY')) {
    code = 'CONFLICT';
    safeMessage = 'Data dengan kunci tersebut sudah ada.';
  } else if (message.includes('FOREIGN KEY constraint failed')) {
    code = 'VALIDATION_FAILED';
    safeMessage = 'Referensi data tidak ditemukan.';
  } else if (message.includes('CHECK constraint failed')) {
    code = 'VALIDATION_FAILED';
    safeMessage = 'Nilai data melanggar aturan penyimpanan.';
  } else if (
    message.includes('database is locked') ||
    message.includes('database table is locked')
  ) {
    safeMessage = 'Database sedang dipakai proses lain. Coba lagi.';
  }
  return new AppError(code, { safeMessage, debugDetail: redactText(message), cause: err });
}

function describe(err: unknown): string {
  return redactText(err instanceof Error ? `${err.name}: ${err.message}` : 'unknown error');
}

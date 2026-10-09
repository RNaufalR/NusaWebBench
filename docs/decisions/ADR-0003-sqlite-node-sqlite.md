# ADR-0003: SQLite memakai `node:sqlite` bawaan Node 24

- Status: Accepted
- Tanggal: 2026-10-09
- Terkait: taskbook §3.1 (SQLite lokal), §5.3, T-030

## Konteks

Taskbook meminta SQLite lokal dengan migrasi versioned. Opsi umum adalah `better-sqlite3` (native addon). Native addon memerlukan prebuilt binary atau kompilasi C++ dan Node headers. Sandbox tidak dapat mengakses `nodejs.org` (headers) dan `storage.googleapis.com` (prebuilt tertentu), sehingga instalasi native bisa gagal di lingkungan pengembang maupun CI tanpa akses tersebut.

Node 24.21.0 menyediakan modul `node:sqlite` (SQLite 3.53.4 pada pengujian lokal). Modul ini tidak menambah dependency native. Pada pengujian lokal, `DatabaseSync` tidak mencetak peringatan saat dipakai.

## Keputusan

Gunakan `node:sqlite` (`DatabaseSync`). Tidak ada dependency SQLite pihak ketiga.

Batasan dan mitigasi:

- Modul `node:sqlite` masih berstatus pengembangan aktif di dokumentasi Node. Mitigasi: seluruh akses database berada di `packages/storage` (lapisan `database.ts` + `repositories.ts`). Penggantian ke library lain hanya menyentuh paket itu.
- Prepared statement hanya memakai parameter `?`. Tidak ada string SQL yang dirangkai dari input.
- Pragma yang dipakai: `foreign_keys=ON`, `busy_timeout=5000`, `journal_mode=WAL` (untuk file), `synchronous=NORMAL`.

## Alternatif yang ditolak

- `better-sqlite3`: ditolak untuk tahap ini karena butuh binary native; dapat ditinjau ulang jika `node:sqlite` terbukti tidak memadai (ADR baru).
- ORM (Prisma, Drizzle): ditolak karena menambah lapisan dan dependency tanpa kebutuhan jelas untuk skema kecil.

## Konsekuensi

- Versi Node wajib 24 (`engines`, `.nvmrc`), yang memang sudah dipin.
- Migrasi, checksum, dan penolakan downgrade diimplementasikan sendiri di `packages/storage/src/migrations.ts`.

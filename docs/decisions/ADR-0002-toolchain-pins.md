# ADR-0002: Pin runtime dan toolchain kualitas (T-010)

- Status: Accepted
- Tanggal: 2026-10-09
- Terkait: taskbook §3.1, §3.3, §10.2, T-010

## Konteks

T-010 mengharuskan runtime dan toolchain dipin, lockfile di-commit, dan quality gate berjalan tanpa API key.

Fakta yang diamati di lingkungan (2026-10-09):

- `nodejs.org` tidak dapat dijangkau dari sandbox. Node 24.21.0 diambil dari paket npm `node-linux-x64@24` (binary resmi Node.js, dipasang di luar repo di `/home/user/.toolchain`).
- Halaman release Node.js: v24 berstatus **LTS** (Active), v22 berstatus **LTS** (Maintenance). Taskbook §3.1 mensyaratkan runtime yang didukung, sehingga Node 24 dipilih.
- Dokumentasi resmi: https://nodejs.org/en/about/previous-releases (diakses 2026-10-09).
- npm 10.9.8 (bawaan Node 22 di host) gagal dengan `Cannot read properties of null (reading 'edgesOut')` saat memasang `vitest@4.1.11` (peer-dependency resolution). Kegagalan terjadi konsisten; `vitest@4.0.18` berhasil dipasang.

## Keputusan

| Komponen          | Versi pin                                                                                   | Alasan                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Node.js           | `24.21.0` (`.nvmrc`, `engines >=24 <25`)                                                    | LTS aktif, didukung dependency.                                                                                                   |
| npm               | bawaan Node 24 (npm 11.x) untuk pengembang; CI memakai `actions/setup-node` dengan `.nvmrc` | Lockfile dibuat dengan npm 10.9.8 di host; `npm ci` diverifikasi berhasil.                                                        |
| TypeScript        | `5.9.3`                                                                                     | Dukungan `typescript-eslint 8.71.1` sudah teruji; TypeScript 7.x (rilis baru) belum diverifikasi kompatibel dengan parser ESLint. |
| ESLint            | `9.39.5` (flat config)                                                                      | Dukungan `typescript-eslint` dan `@eslint/js` 9.x. ESLint 10 belum dipakai.                                                       |
| typescript-eslint | `8.71.1`                                                                                    | Konfigurasi `strict` (non type-aware).                                                                                            |
| Prettier          | `3.9.9`                                                                                     | Formatter tunggal.                                                                                                                |
| Vitest            | `4.0.18`                                                                                    | Versi yang berhasil dipasang di lingkungan ini; `4.1.11` ditolak karena bug npm di atas.                                          |
| Vite              | `8.3.4` (dipin sebagai peer untuk Vitest; dipakai di T-140)                                 | Disesuaikan dengan peer range Vitest 4.0.x.                                                                                       |
| @types/node       | `24.19.1`                                                                                   | Sesuai runtime Node 24.                                                                                                           |

Catatan: versi terbaru `typescript 7.0.2`, `eslint 10.x`, dan `vitest 4.1.11` belum dipakai. Ini adalah keputusan konservatif, bukan klaim bahwa versi tersebut rusak. Upgrade dapat dilakukan di ADR baru setelah kompatibilitas diuji.

## Konsekuensi

- `npm run check` menjalankan: format check, lint (`--max-warnings=0`), typecheck (`strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes`), unit test, dan secret scan.
- `build` belum didefinisikan. Script palsu yang hanya `echo` dihapus. Build akan ditambahkan bersama workspace pertama (T-140).
- Workspaces (`apps/*`, `packages/*`) belum dikonfigurasi. npm 10.9.8 gagal dengan direktori workspace kosong; workspace ditambahkan bersama paket pertama.

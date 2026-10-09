# NusaWebBench

NusaWebBench adalah toolkit audit kualitas website yang **lokal-first**, **evidence-first**, dan **deterministik** untuk pengukuran inti. Status proyek saat ini: fondasi pengembangan (lihat `IMPLEMENTATION_STATUS.md`). Belum ada fitur audit yang dinyatakan siap.

## Prasyarat

- Node.js `24.21.0` (lihat `.nvmrc`). Versi lain di luar `>=24 <25` ditolak oleh `engines`.
- npm (bawaan Node).

## Setup dan quality gates

```bash
npm ci
npm run check
```

`npm run check` menjalankan secara berurutan:

| Script                 | Fungsi                                            |
| ---------------------- | ------------------------------------------------- |
| `npm run format:check` | Prettier `--check`                                |
| `npm run lint`         | ESLint (flat config, `--max-warnings=0`)          |
| `npm run typecheck`    | TypeScript strict                                 |
| `npm run test`         | Vitest (unit test)                                |
| `npm run secret-scan`  | Pemindaian pola secret pada file yang dilacak git |

Tidak ada API key, akun cloud, Docker, atau akses internet yang dibutuhkan untuk gate ini.

## Konfigurasi

Salin `.env.example` ke `.env` jika perlu. Jangan pernah commit `.env`. Default aman:
`AI_PROVIDER=none`, `FREE_TIER_LOCK=true`, `STRIX_ENABLED=false`, `K6_ENABLED=false`.

## Dokumentasi

- `NusaWebBench_Master_Spec_and_Taskbook.md` — spesifikasi dan task (sumber kebenaran).
- `IMPLEMENTATION_STATUS.md` — status setiap task beserta bukti.
- `docs/decisions/` — ADR (keputusan arsitektur).

## Lisensi

Belum ditentukan oleh pemilik repositori. Sampai ada file `LICENSE`, kode ini tidak diberikan lisensi open source.

#!/usr/bin/env bash
# Membangun binary k6 dari sumber tag resmi untuk verifikasi lokal T-150 (tes `packages/load-k6`).
#
# Rantai kepercayaan:
#  - Tag dan commit dipin di bawah. Skrip menolak jika commit hasil clone berbeda.
#  - Dependensi berasal dari direktori `vendor/` yang ada di dalam commit tersebut (build -mod=vendor,
#    tanpa akses proxy modul).
#  - Toolchain Go tidak diunduh oleh skrip. Gunakan Go yang Anda percaya (versi >= go.mod, saat ini 1.26).
#
# Pemakaian:
#   scripts/build-k6-verified.sh [direktori-keluaran]
#   K6_BIN=<direktori-keluaran>/k6 npx vitest run packages/load-k6
#
# Binary dan sumber TIDAK disimpan di repository (hasil ada di direktori keluaran di luar Git).
set -euo pipefail

K6_TAG="v2.3.0"
K6_COMMIT="e0887846143ab176d4b5483c9d52cf3b3e009f1a"
OUT_DIR="${1:-${HOME}/.cache/nwb-k6}"

if ! command -v go >/dev/null 2>&1; then
  echo "Go tidak ditemukan. Pasang Go (>= 1.26) lalu jalankan ulang." >&2
  exit 1
fi
if ! command -v git >/dev/null 2>&1; then
  echo "git tidak ditemukan." >&2
  exit 1
fi

rm -rf "${OUT_DIR}/src"
mkdir -p "${OUT_DIR}"
git clone --quiet --depth 1 --branch "${K6_TAG}" https://github.com/grafana/k6 "${OUT_DIR}/src"

ACTUAL="$(git -C "${OUT_DIR}/src" rev-parse HEAD)"
if [ "${ACTUAL}" != "${K6_COMMIT}" ]; then
  echo "Commit untuk ${K6_TAG} tidak cocok: diharapkan ${K6_COMMIT}, didapat ${ACTUAL}." >&2
  exit 1
fi

(cd "${OUT_DIR}/src" && GOFLAGS=-mod=vendor go build -trimpath -o "${OUT_DIR}/k6" .)
"${OUT_DIR}/k6" version
echo "Binary: ${OUT_DIR}/k6"
echo "Jalankan: K6_BIN=${OUT_DIR}/k6 npx vitest run packages/load-k6"

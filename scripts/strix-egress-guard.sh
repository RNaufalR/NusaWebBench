#!/usr/bin/env bash
# F-10: batasi egress container sandbox Strix di runner Linux (Docker + iptables/ip6tables).
#
# Pemakaian:
#   strix-egress-guard.sh apply     pasang aturan, lalu verifikasi bahwa aturan benar-benar aktif
#   strix-egress-guard.sh verify    hanya cek aturan (exit 1 bila ada yang hilang)
#   strix-egress-guard.sh teardown  hapus aturan (idempotent; aman dipanggil setelah sukses/gagal)
#
# Interface bridge TIDAK diasumsikan docker0. Urutan penentuan:
#   1. NWB_DOCKER_IFACE (override eksplisit; dipakai uji netns dan DRY_RUN)
#   2. nama bridge dari network Docker yang dipakai Strix (STRIX_DOCKER_SANDBOX_NETWORK, default "bridge")
#      via `docker network inspect`. Network "bridge" tanpa opsi nama memakai docker0.
#
# Aturan (per family: iptables dan ip6tables):
#   - DOCKER-USER: DROP semua forwarding dari bridge ke interface lain (internet, LAN, network Docker lain).
#     Chain ini dievaluasi sebelum aturan ACCEPT Docker, sehingga berlaku untuk port yang dipublish juga.
#   - INPUT: ACCEPT hanya TCP ke STRIX_FIXTURE_PORT di host; semua trafik lain dari bridge DROP.
#     Ini juga memblokir DNS ke resolver host (53) dan layanan host lain.
#
# Fail-closed: `apply` keluar non-nol bila ada langkah yang gagal atau verifikasi gagal.
# Jalur yang TIDAK tercakup (lihat SECURITY_REMEDIATION_REPORT.md): container dengan --network host,
# container di network lain yang tidak melewati bridge ini, dan IPv6 bila Docker tidak memakai ip6tables.
set -euo pipefail

MODE="${1:-apply}"
case "$MODE" in apply | verify | teardown) ;; *) echo "mode tidak dikenal: $MODE" >&2; exit 2 ;; esac

PORT="${STRIX_FIXTURE_PORT:-}"
if ! [[ "$PORT" =~ ^[0-9]{1,5}$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "STRIX_FIXTURE_PORT tidak valid atau kosong." >&2
  exit 2
fi

DRY_RUN="${DRY_RUN:-0}"

detect_iface() {
  if [ -n "${NWB_DOCKER_IFACE:-}" ]; then
    printf '%s' "$NWB_DOCKER_IFACE"
    return 0
  fi
  if [ "$DRY_RUN" = "1" ]; then
    echo "DRY_RUN memerlukan NWB_DOCKER_IFACE." >&2
    return 1
  fi
  local net="${STRIX_DOCKER_SANDBOX_NETWORK:-bridge}"
  if ! [[ "$net" =~ ^[A-Za-z0-9_.-]{1,128}$ ]]; then
    echo "STRIX_DOCKER_SANDBOX_NETWORK tidak valid." >&2
    return 1
  fi
  local name
  name="$(docker network inspect "$net" -f '{{index .Options "com.docker.network.bridge.name"}}' 2>/dev/null || true)"
  if [ -z "$name" ] || [ "$name" = "<no value>" ]; then
    if [ "$net" = "bridge" ]; then name="docker0"; else
      echo "Nama bridge untuk network '$net' tidak ditemukan." >&2
      return 1
    fi
  fi
  printf '%s' "$name"
}

IFACE="$(detect_iface)"
if ! [[ "$IFACE" =~ ^[A-Za-z0-9_.-]{1,15}$ ]]; then
  echo "Nama interface tidak valid." >&2
  exit 2
fi

# Menjalankan perintah (atau mencetaknya pada DRY_RUN). Kegagalan dilaporkan ke pemanggil.
run() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '%s\n' "$*"
  else
    "$@"
  fi
}

# Perintah yang boleh gagal (menghapus aturan yang tidak ada).
run_quiet() {
  if [ "$DRY_RUN" = "1" ]; then
    printf '%s\n' "$*"
  else
    "$@" 2>/dev/null || true
  fi
}

FAMILIES=(iptables ip6tables)

remove_rules() {
  local fam="$1"
  run_quiet sudo "$fam" -D DOCKER-USER -i "$IFACE" ! -o "$IFACE" -j DROP
  run_quiet sudo "$fam" -D INPUT -i "$IFACE" -p tcp --dport "$PORT" -j ACCEPT
  run_quiet sudo "$fam" -D INPUT -i "$IFACE" -j DROP
}

# Docker membuat DOCKER-USER dan lompatan FORWARD -> DOCKER-USER. Bila belum ada (mis. ip6tables
# tanpa IPv6 di Docker), guard membuatnya agar aturan tetap dievaluasi. Teardown tidak menghapusnya.
ensure_chain() {
  local fam="$1"
  if [ "$DRY_RUN" = "1" ]; then
    printf '%s\n' "ensure $fam DOCKER-USER + jump FORWARD"
    return 0
  fi
  if ! sudo "$fam" -S DOCKER-USER >/dev/null 2>&1; then
    sudo "$fam" -N DOCKER-USER || return 1
  fi
  if ! sudo "$fam" -C FORWARD -j DOCKER-USER 2>/dev/null; then
    sudo "$fam" -I FORWARD 1 -j DOCKER-USER || return 1
  fi
}

install_rules() {
  local fam="$1"
  # Urutan penyisipan: aturan yang disisipkan terakhir di posisi 1 berada paling atas.
  run sudo "$fam" -I DOCKER-USER 1 -i "$IFACE" ! -o "$IFACE" -j DROP
  run sudo "$fam" -I INPUT 1 -i "$IFACE" -j DROP
  run sudo "$fam" -I INPUT 1 -i "$IFACE" -p tcp --dport "$PORT" -j ACCEPT
}

check_rules() {
  local fam="$1"
  sudo "$fam" -C DOCKER-USER -i "$IFACE" ! -o "$IFACE" -j DROP &&
    sudo "$fam" -C INPUT -i "$IFACE" -p tcp --dport "$PORT" -j ACCEPT &&
    sudo "$fam" -C INPUT -i "$IFACE" -j DROP
}

case "$MODE" in
  apply)
    for fam in "${FAMILIES[@]}"; do
      ensure_chain "$fam" || { echo "gagal menyiapkan chain $fam (fail-closed)" >&2; exit 1; }
      remove_rules "$fam"
      install_rules "$fam"
    done
    if [ "$DRY_RUN" = "1" ]; then
      echo "DRY_RUN: verifikasi dilewati (tidak ada aturan yang dipasang)."
    else
      for fam in "${FAMILIES[@]}"; do
        if ! check_rules "$fam"; then
          echo "VERIFIKASI GAGAL: aturan $fam tidak aktif. Run dihentikan (fail-closed)." >&2
          exit 1
        fi
      done
    fi
    if [ "$DRY_RUN" = "1" ]; then
      echo "DRY_RUN: perintah di atas (tidak dijalankan), iface=$IFACE fixture-port=$PORT"
    else
      echo "egress guard aktif: iface=$IFACE fixture-port=$PORT"
    fi
    ;;
  verify)
    for fam in "${FAMILIES[@]}"; do
      if ! check_rules "$fam"; then
        echo "aturan $fam tidak lengkap" >&2
        exit 1
      fi
    done
    echo "egress guard terverifikasi: iface=$IFACE fixture-port=$PORT"
    ;;
  teardown)
    for fam in "${FAMILIES[@]}"; do
      remove_rules "$fam"
    done
    echo "egress guard dihapus: iface=$IFACE"
    ;;
esac

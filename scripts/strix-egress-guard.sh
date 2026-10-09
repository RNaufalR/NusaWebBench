#!/usr/bin/env bash
# F-10: batasi egress container sandbox Strix di runner terisolasi (Linux + Docker + iptables).
#
# Aturan:
# - Container di bridge default (docker0) tidak boleh meneruskan trafik keluar ke interface lain
#   (internet atau LAN). Lewat chain DOCKER-USER, yang dievaluasi sebelum aturan Docker.
# - Container hanya boleh menghubungi port forwarder fixture (STRIX_FIXTURE_PORT) di host.
#   Trafik lain dari docker0 ke host (INPUT) ditolak.
#
# Batasan yang diketahui (lihat SECURITY_REMEDIATION_REPORT.md): DNS dari container ikut ditolak.
# Sandbox Strix tidak memerlukannya karena host.docker.internal sudah dipetakan lewat extra_hosts.
# Agen LLM berjalan di proses host, bukan di container, sehingga tidak terpengaruh aturan ini.
#
# DRY_RUN=1 hanya mencetak perintah (dipakai tes). Tanpa DRY_RUN, butuh sudo di runner.
set -euo pipefail

IFACE="${NWB_DOCKER_IFACE:-docker0}"
PORT="${STRIX_FIXTURE_PORT:-}"

if ! [[ "$PORT" =~ ^[0-9]{1,5}$ ]] || [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  echo "STRIX_FIXTURE_PORT tidak valid atau kosong." >&2
  exit 2
fi
if ! [[ "$IFACE" =~ ^[A-Za-z0-9_.-]{1,15}$ ]]; then
  echo "NWB_DOCKER_IFACE tidak valid." >&2
  exit 2
fi

run() {
  if [ "${DRY_RUN:-0}" = "1" ]; then
    printf '%s\n' "$*"
  else
    "$@"
  fi
}

# Idempotent: hapus aturan yang mungkin tersisa dari run sebelumnya (abaikan bila tidak ada).
run_quiet() {
  if [ "${DRY_RUN:-0}" = "1" ]; then
    printf '%s\n' "$*"
  else
    "$@" 2>/dev/null || true
  fi
}
run_quiet sudo iptables -D DOCKER-USER -i "$IFACE" ! -o "$IFACE" -j DROP
run_quiet sudo iptables -D INPUT -i "$IFACE" -p tcp --dport "$PORT" -j ACCEPT
run_quiet sudo iptables -D INPUT -i "$IFACE" -j DROP

# Urutan penyisipan: aturan terakhir yang disisipkan di posisi 1 berada paling atas.
run sudo iptables -I DOCKER-USER 1 -i "$IFACE" ! -o "$IFACE" -j DROP
run sudo iptables -I INPUT 1 -i "$IFACE" -j DROP
run sudo iptables -I INPUT 1 -i "$IFACE" -p tcp --dport "$PORT" -j ACCEPT

echo "egress guard aktif: iface=$IFACE fixture-port=$PORT"

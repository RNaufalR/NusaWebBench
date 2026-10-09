#!/usr/bin/env bash
# F-10: uji runtime egress guard di network namespace terisolasi (Linux, butuh sudo).
#
# Topologi (semua namespace dan veth bernama nwb-* / nwbt*, dibersihkan otomatis):
#   nwb-ctr (172.31.0.2)  --- nwbtest0 bridge (host 172.31.0.1) ---  host (root namespace)
#   nwb-ctr                                                          |
#                                              nwbx-h (10.99.0.1) --- nwbx-c (10.99.0.2) nwb-ext
#
# Fixture yang diizinkan: 172.31.0.1:$FIXTURE_PORT (host). Layanan host terlarang: 172.31.0.1:$FORBID_PORT.
# Host eksternal terlarang: 10.99.0.2:80 (namespace nwb-ext).
#
# Fase:
#   1. KONTROL tanpa guard: fixture, layanan terlarang, dan host eksternal HARUS terjangkau.
#      Bila tidak, topologi tidak valid dan uji dihentikan (tidak ada klaim efektivitas).
#   2. Pasang guard (apply) dan verifikasi: fixture terjangkau; layanan terlarang dan eksternal GAGAL.
#   3. Teardown: aturan hilang dan host eksternal kembali terjangkau (pembersihan terbukti).
#
# Ini memakai netfilter kernel yang sama dengan Docker, tetapi bukan container Docker sungguhan.
# Batasan dicatat di SECURITY_REMEDIATION_REPORT.md.
set -euo pipefail

if [ "$(id -u)" -ne 0 ] && ! sudo -n true 2>/dev/null; then
  echo "Butuh root atau sudo tanpa password." >&2
  exit 2
fi

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GUARD="$HERE/strix-egress-guard.sh"
FIXTURE_PORT="${FIXTURE_PORT:-4600}"
FORBID_PORT="${FORBID_PORT:-4601}"
EXT_PORT=8080
BRIDGE=nwbtest0
export NWB_DOCKER_IFACE="$BRIDGE"
export STRIX_FIXTURE_PORT="$FIXTURE_PORT"

WORK="$(mktemp -d)"
PIDS=()

S() { sudo "$@"; }

declare -A CREATED_CHAIN=([iptables]=0 [ip6tables]=0)
declare -A CREATED_JUMP=([iptables]=0 [ip6tables]=0)

cleanup() {
  set +e
  # Bunuh seluruh proses run ini (wrapper sudo dan anak python), dikenali dari direktori kerja unik.
  S pkill -f -- "$WORK" 2>/dev/null
  sleep 0.5
  bash "$GUARD" teardown >/dev/null 2>&1
  for fam in iptables ip6tables; do
    if [ "${CREATED_JUMP[$fam]}" = "1" ]; then S "$fam" -D FORWARD -j DOCKER-USER 2>/dev/null; fi
    if [ "${CREATED_CHAIN[$fam]}" = "1" ]; then
      S "$fam" -F DOCKER-USER 2>/dev/null
      S "$fam" -X DOCKER-USER 2>/dev/null
    fi
  done
  S ip netns del nwb-ctr 2>/dev/null
  S ip netns del nwb-ext 2>/dev/null
  S ip link del "$BRIDGE" 2>/dev/null
  S ip link del nwbx-h 2>/dev/null
  rm -rf "$WORK"
}
trap cleanup EXIT

fail() { echo "GAGAL: $*" >&2; exit 1; }

# Docker membuat DOCKER-USER dan lompatan FORWARD -> DOCKER-USER pada runner sungguhan.
# Di sini keduanya dibuat bila belum ada, dan dihapus kembali oleh cleanup.
for fam in iptables ip6tables; do
  if ! S "$fam" -S DOCKER-USER >/dev/null 2>&1; then
    S "$fam" -N DOCKER-USER
    CREATED_CHAIN[$fam]=1
  fi
  if ! S "$fam" -C FORWARD -j DOCKER-USER 2>/dev/null; then
    S "$fam" -I FORWARD 1 -j DOCKER-USER
    CREATED_JUMP[$fam]=1
  fi
done
S sysctl -qw net.ipv4.ip_forward=1

# --- Topologi ---
S ip netns add nwb-ctr
S ip netns add nwb-ext
S ip link add "$BRIDGE" type bridge
S ip addr add 172.31.0.1/24 dev "$BRIDGE"
S ip link set "$BRIDGE" up
S ip link add nwbt-h type veth peer name nwbt-c
S ip link set nwbt-h master "$BRIDGE"
S ip link set nwbt-h up
S ip link set nwbt-c netns nwb-ctr
S ip netns exec nwb-ctr ip addr add 172.31.0.2/24 dev nwbt-c
S ip netns exec nwb-ctr ip link set nwbt-c up
S ip netns exec nwb-ctr ip link set lo up
S ip netns exec nwb-ctr ip route add default via 172.31.0.1

S ip link add nwbx-h type veth peer name nwbx-c
S ip link set nwbx-c netns nwb-ext
S ip addr add 10.99.0.1/24 dev nwbx-h
S ip link set nwbx-h up
S ip netns exec nwb-ext ip addr add 10.99.0.2/24 dev nwbx-c
S ip netns exec nwb-ext ip link set nwbx-c up
S ip netns exec nwb-ext ip link set lo up
S ip netns exec nwb-ext ip route add default via 10.99.0.1
# Container mencapai host eksternal lewat forwarding host (jalur yang harus diblokir guard).
# Policy FORWARD host ini ACCEPT, sehingga forwarding kontrol tidak memerlukan aturan ACCEPT tambahan.
# Aturan ACCEPT jangan disisipkan di atas DOCKER-USER: itu akan melewati guard (bug uji yang sudah diperbaiki).

# --- Layanan ---
python3 -m http.server "$FIXTURE_PORT" --bind 172.31.0.1 --directory "$WORK" >"$WORK/fixture.log" 2>&1 &
PIDS+=($!)
python3 -m http.server "$FORBID_PORT" --bind 172.31.0.1 --directory "$WORK" >"$WORK/forbid.log" 2>&1 &
PIDS+=($!)
S ip netns exec nwb-ext python3 -m http.server "$EXT_PORT" --bind 10.99.0.2 --directory "$WORK" >"$WORK/ext.log" 2>&1 &
PIDS+=($!)
# Tunggu sampai setiap layanan benar-benar listen. `http.server` memanggil getfqdn saat bind,
# sehingga listen bisa tertunda; sleep tetap tidak cukup.
wait_listen() { # wait_listen <ns|-> <ip> <port>
  local ns="$1" ip="$2" port="$3" i
  for i in $(seq 1 50); do
    if [ "$ns" = "-" ]; then
      ss -ltn "( sport = :$port )" 2>/dev/null | grep -q "$ip:$port" && return 0
    else
      S ip netns exec "$ns" ss -ltn "( sport = :$port )" 2>/dev/null | grep -q "$ip:$port" && return 0
    fi
    sleep 0.2
  done
  fail "layanan $ip:$port tidak listen (lihat log di $WORK)"
}
wait_listen - 172.31.0.1 "$FIXTURE_PORT"
wait_listen - 172.31.0.1 "$FORBID_PORT"
wait_listen nwb-ext 10.99.0.2 "$EXT_PORT"

probe() { # probe <url>; keluar 0 bila terjangkau dari container
  S ip netns exec nwb-ctr curl -s -o /dev/null -m 3 -w '%{http_code}' "$1" 2>/dev/null | grep -qE '^[1-5][0-9][0-9]$'
}

# Hitungan request yang benar-benar diterima server (dari log http.server). Bukti sisi server.
hits_in() { grep -c '"GET ' "$1" 2>/dev/null || echo 0; }

FIX="http://172.31.0.1:$FIXTURE_PORT/"
FORB="http://172.31.0.1:$FORBID_PORT/"
EXT="http://10.99.0.2:$EXT_PORT/"

echo "== Fase 1: kontrol tanpa guard"
probe "$FIX" || fail "kontrol: fixture tidak terjangkau (topologi tidak valid)"
probe "$FORB" || fail "kontrol: layanan host tidak terjangkau (topologi tidak valid)"
probe "$EXT" || { cat "$WORK/ext.log" >&2 || true; fail "kontrol: host eksternal tidak terjangkau (topologi tidak valid)"; }
EXT_BEFORE=$(hits_in "$WORK/ext.log")
FORB_BEFORE=$(hits_in "$WORK/forbid.log")
[ "$EXT_BEFORE" -ge 1 ] || fail "kontrol: log server eksternal tidak mencatat request (uji tidak bermakna)"
echo "kontrol OK: fixture, layanan host, dan host eksternal terjangkau tanpa guard"

echo "== Fase 2: pasang guard"
bash "$GUARD" apply || fail "apply gagal"
bash "$GUARD" verify || fail "verifikasi aturan gagal"
probe "$FIX" && echo "OK positif: fixture yang diizinkan terjangkau" || fail "fixture yang diizinkan TIDAK terjangkau"
if probe "$FORB"; then fail "layanan host terlarang TERJANGKAU (guard tidak efektif)"; fi
sleep 0.5
[ "$(hits_in "$WORK/forbid.log")" = "$FORB_BEFORE" ] || fail "layanan host terlarang MENERIMA request (tidak diblokir di jalur paket)"
echo "OK negatif: layanan host terlarang diblokir"
if probe "$EXT"; then fail "host eksternal TERJANGKAU (forwarding tidak diblokir)"; fi
sleep 0.5
[ "$(hits_in "$WORK/ext.log")" = "$EXT_BEFORE" ] || fail "host eksternal MENERIMA request (forwarding tidak diblokir)"
echo "OK negatif: host eksternal diblokir"

echo "== Fase 3: teardown"
bash "$GUARD" teardown || fail "teardown gagal"
if bash "$GUARD" verify >/dev/null 2>&1; then fail "aturan masih ada setelah teardown"; fi
probe "$EXT" || fail "host eksternal masih diblokir setelah teardown (pembersihan tidak lengkap)"

echo "OK: teardown menghapus aturan; jalur kembali terbuka"

echo "SELESAI: uji netns egress guard lulus (kontrol, positif, negatif, teardown)."

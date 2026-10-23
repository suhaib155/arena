#!/usr/bin/env bash
# Runs gameplay-challenge-burst.ts once per plan line on a throwaway cluster (see gameplay-bench-cluster.sh).
# Local only. Several instances may run at once if each has its own BENCH_PG_DIR and BENCH_PG_PORT (WAL and CPU
# are per cluster, so parallel clusters do not mix those; they do share the machine's CPU).
#
#   BENCH_PG_DIR=/tmp/pgb1 BENCH_PG_PORT=55433 gameplay-challenge-burst-matrix.sh <plan.tsv> <outdir>
#
# plan.tsv, tab-separated, no header:  label <TAB> postgres settings (';'-separated) <TAB> burst arguments (e.g. "--variant baseline --pace-seconds 900")
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PLAN="$(realpath "$1")"; OUT="$2"; mkdir -p "$OUT"; OUT="$(realpath "$OUT")"
DIR="${BENCH_PG_DIR:-/tmp/movenrun-pgbench16}"; PORT="${BENCH_PG_PORT:-55432}"
export BENCH_PG_DIR="$DIR" BENCH_PG_PORT="$PORT"
[ -d "$DIR/data" ] || "$HERE/gameplay-bench-cluster.sh" init
while IFS=$'\t' read -r label settings args; do
  [ -z "$label" ] && continue
  case "$label" in \#*) continue ;; esac
  [ -s "$OUT/$label.json" ] && { echo "skip $label (done)"; continue; }
  echo "== $label  [$settings] $args"
  "$HERE/gameplay-bench-cluster.sh" start "log_autovacuum_min_duration=0;$settings" >/dev/null
  ( cd "$HERE/.." && MOVENRUN_BENCH_DATABASE_URL="postgres://bench@127.0.0.1:$PORT/postgres" \
      node --import tsx scripts/gameplay-challenge-burst.ts $args --server-log "$DIR/server.log" --out "$OUT/$label.json" ) 2>&1 | tail -2
  cp "$DIR/server.log" "$OUT/$label.log"
done < "$PLAN"
"$HERE/gameplay-bench-cluster.sh" stop

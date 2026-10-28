#!/usr/bin/env bash
# Runs the storage bench once per line of a plan file, on the throwaway cluster of gameplay-bench-cluster.sh,
# restarting it with each line's PostgreSQL settings. Local only. Results go to <outdir>/<label>.json and
# the server log (autovacuum log lines, with CPU) to <outdir>/<label>.log.
#
#   gameplay-bench-matrix.sh <plan.tsv> <outdir>
#
# plan.tsv, tab-separated, no header:  label <TAB> postgres settings (';'-separated) <TAB> scenario JSON (one partial scenario)
# Needs the cluster initialised first (gameplay-bench-cluster.sh init).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
PLAN="$(realpath "$1")"; OUT="$2"; mkdir -p "$OUT"; OUT="$(realpath "$OUT")"
PORT="${BENCH_PG_PORT:-55432}"
while IFS=$'\t' read -r label settings scenario; do
  [ -z "$label" ] && continue
  case "$label" in \#*) continue ;; esac
  [ -s "$OUT/$label.json" ] && { echo "skip $label (done)"; continue; }
  echo "== $label  [$settings]"
  "$HERE/gameplay-bench-cluster.sh" start "log_autovacuum_min_duration=0;$settings" >/dev/null
  printf '[%s]\n' "$scenario" > "$OUT/$label.scenario.json"
  ( cd "$HERE/.." && MOVENRUN_BENCH_DATABASE_URL="postgres://bench@127.0.0.1:$PORT/postgres" \
      node --import tsx scripts/gameplay-storage-bench.ts --profile matrix --scenario-json "$OUT/$label.scenario.json" --out "$OUT/$label.json" ) 2>&1 | tail -3
  cp "${BENCH_PG_DIR:-/tmp/movenrun-pgbench16}/server.log" "$OUT/$label.log"
done < "$PLAN"
"$HERE/gameplay-bench-cluster.sh" stop

#!/usr/bin/env bash
# Throwaway local PostgreSQL 16 cluster for the storage / autovacuum benchmarks. Local only: binds 127.0.0.1,
# trust auth, its own data directory, never the shared cluster. WAL and CPU numbers are only meaningful on a
# cluster nothing else writes to, which is why the benchmarks use this one.
#
#   gameplay-bench-cluster.sh init                 create the data directory (once)
#   gameplay-bench-cluster.sh start "<settings>"   (re)start with extra settings, ';'-separated, e.g. "autovacuum_naptime=1s;autovacuum=off"
#   gameplay-bench-cluster.sh stop
#   gameplay-bench-cluster.sh destroy              stop and delete the data directory
#
# Environment: BENCH_PG_DIR (default /tmp/movenrun-pgbench16), BENCH_PG_PORT (default 55432), BENCH_PG_BIN (default /usr/lib/postgresql/16/bin).
# When run as root the server runs as the "postgres" OS user (PostgreSQL refuses to run as root).
set -euo pipefail
DIR="${BENCH_PG_DIR:-/tmp/movenrun-pgbench16}"
PORT="${BENCH_PG_PORT:-55432}"
BIN="${BENCH_PG_BIN:-/usr/lib/postgresql/16/bin}"
DATA="$DIR/data"
as() { if [ "$(id -u)" = 0 ]; then sudo -u postgres "$@"; else "$@"; fi; }
case "${1:-}" in
  init)
    mkdir -p "$DIR"; [ "$(id -u)" = 0 ] && chown postgres "$DIR"
    as "$BIN/initdb" -D "$DATA" -U bench --auth=trust -E UTF8 >/dev/null
    as tee -a "$DATA/postgresql.conf" >/dev/null <<CONF
port = $PORT
listen_addresses = '127.0.0.1'
unix_socket_directories = '$DIR'
shared_buffers = 256MB
max_connections = 100
logging_collector = off
track_io_timing = on
CONF
    echo "initialised $DATA on port $PORT"
    ;;
  start)
    as "$BIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true
    # Drop the previous run's settings block, then append this run's.
    as sed -i '/^# --- bench settings ---$/,$d' "$DATA/postgresql.conf"
    { echo "# --- bench settings ---"; echo "${2:-}" | tr ';' '\n'; } | as tee -a "$DATA/postgresql.conf" >/dev/null
    : > "$DIR/server.log"; [ "$(id -u)" = 0 ] && chown postgres "$DIR/server.log"
    as "$BIN/pg_ctl" -D "$DATA" -l "$DIR/server.log" -w start >/dev/null
    echo "started on 127.0.0.1:$PORT (user bench, trust): MOVENRUN_BENCH_DATABASE_URL=postgres://bench@127.0.0.1:$PORT/postgres"
    ;;
  stop) as "$BIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true ;;
  destroy) as "$BIN/pg_ctl" -D "$DATA" -m fast stop >/dev/null 2>&1 || true; rm -rf "$DIR" ;;
  *) echo "usage: $0 init|start \"settings\"|stop|destroy" >&2; exit 2 ;;
esac

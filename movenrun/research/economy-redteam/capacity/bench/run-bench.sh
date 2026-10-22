#!/usr/bin/env bash
# B5 local bench driver. NOT part of the default test run. Throwaway PostgreSQL 16 cluster on 127.0.0.1 only.
# usage: bench/run-bench.sh <config: default|aggressive> <players> [days-profile=integration]
# The cluster must live where the unprivileged postgres user can read it, so it is created in a temp directory
# (mktemp under TMPDIR, default /tmp). It is deleted at the end of every run.
set -euo pipefail
CFG=${1:?config}; PLAYERS=${2:?players}
case $CFG in default|aggressive) ;; *) echo "config must be default or aggressive" >&2; exit 2;; esac
case $PLAYERS in ''|*[!0-9]*) echo "players must be a number" >&2; exit 2;; esac
HERE=$(cd "$(dirname "$0")/.." && pwd)
MOVENRUN=$(cd "$HERE/../../.." && pwd)
BIN=/usr/lib/postgresql/16/bin
PORT=55435
DIR=$(mktemp -d "${TMPDIR:-/tmp}/b5-pg-$CFG.XXXXXX")
OUT=$HERE/out/bench-$CFG-$PLAYERS
chown postgres "$DIR"
runuser -u postgres -- $BIN/initdb -D "$DIR/data" -A trust -U bench >/dev/null
cat >> "$DIR/data/postgresql.conf" <<CONF
listen_addresses = '127.0.0.1'
port = $PORT
unix_socket_directories = '$DIR'
fsync = off
synchronous_commit = off
max_wal_size = 64GB
checkpoint_timeout = 1h
log_min_messages = warning
CONF
if [ "$CFG" = aggressive ]; then cat >> "$DIR/data/postgresql.conf" <<CONF
autovacuum_naptime = 5s
autovacuum_vacuum_scale_factor = 0.02
autovacuum_vacuum_threshold = 50
autovacuum_vacuum_cost_delay = 0
autovacuum_vacuum_cost_limit = 4000
CONF
fi
runuser -u postgres -- $BIN/pg_ctl -D "$DIR/data" -l "$DIR/log" -w start >/dev/null
trap 'runuser -u postgres -- $BIN/pg_ctl -D "$DIR/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$DIR"' EXIT
DBHOST=127.0.0.1
[ "$DBHOST" = 127.0.0.1 ] || { echo "refusing non-loopback database host" >&2; exit 2; }
export MOVENRUN_BENCH_DATABASE_URL=postgres://bench@$DBHOST:$PORT/postgres
cd "$MOVENRUN/backend"
node --import tsx "$HERE/bench/sampler.ts" "$OUT.samples.csv" &
SP=$!
node --import tsx scripts/gameplay-storage-bench.ts --profile integration --only "r3-res10-$PLAYERS" --out "$OUT.json" --markdown /dev/null ${WAL_ATTR:+--keep}
kill $SP 2>/dev/null || true
if [ -n "${WAL_ATTR:-}" ]; then
  # Attribute WAL bytes to relations: sum pg_waldump record lengths per relfilenode, then name them from pg_class.
  DBOID=$(psql -h 127.0.0.1 -p $PORT -U bench -Atc "select oid from pg_database where datname like 'bench%' or datname like 'r3%' order by oid desc limit 1" postgres)
  DBNAME=$(psql -h 127.0.0.1 -p $PORT -U bench -Atc "select datname from pg_database where oid=$DBOID" postgres)
  psql -h 127.0.0.1 -p $PORT -U bench -Atc "checkpoint" postgres >/dev/null
  runuser -u postgres -- bash -c "cd $DIR/data/pg_wal && $BIN/pg_waldump -p . $(ls $DIR/data/pg_wal | grep -E '^[0-9A-F]{24}$' | sort | head -1) $(ls $DIR/data/pg_wal | grep -E '^[0-9A-F]{24}$' | sort | tail -1) 2>/dev/null" \
    | awk -v db=$DBOID '{ if (match($0,/len \(rec\/tot\): +[0-9]+\/ *[0-9]+/)) { split(substr($0,RSTART,RLENGTH),a,/[:\/ ]+/); tot=a[length(a)] } else next; if (match($0,/rel [0-9]+\/[0-9]+\/[0-9]+/)) { split(substr($0,RSTART+4,RLENGTH-4),r,"/"); if (r[2]==db) { b[r[3]]+=tot; n[r[3]]++ } } } END { for (f in b) print f","b[f]","n[f] }' > "$OUT.walfiles.csv"
  psql -h 127.0.0.1 -p $PORT -U bench -d "$DBNAME" -Atc "select relfilenode||','||relname||','||relkind from pg_class where relfilenode<>0 and relnamespace in (select oid from pg_namespace where nspname in ('public','gameplay_partitions'))" > "$OUT.relmap.csv"
  python3 - "$OUT" <<'PY'
import sys,csv
o=sys.argv[1]
m={}
for l in open(o+".relmap.csv"):
    f,n,k=l.strip().split(","); m[f]=(n,k)
agg={}
for l in open(o+".walfiles.csv"):
    f,b,c=l.strip().split(",")
    n,k=m.get(f,("(other/system)","?"))
    # fold partitions and indexes into their owning table by name prefix
    base=n
    for suf in ("_pkey","_idx","_key","_uniq"):
        pass
    a=agg.setdefault(n,[0,0]); a[0]+=int(b); a[1]+=int(c)
with open(o+".walbyrel.csv","w") as w:
    w.write("relation,wal_bytes,records\n")
    for n,(b,c) in sorted(agg.items(), key=lambda x:-x[1][0])[:40]: w.write(f"{n},{b},{c}\n")
PY
  rm -f "$OUT.walfiles.csv" "$OUT.relmap.csv"
fi
echo "autovacuum config: $CFG" > "$OUT.cfg.txt"; grep -E "autovacuum|fsync|max_wal" "$DIR/data/postgresql.conf" | grep -v '^#' >> "$OUT.cfg.txt"

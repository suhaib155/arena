#!/usr/bin/env bash
# Runs the full B5 bench matrix sequentially (about 25 minutes). Not part of the test run.
cd "$(dirname "$0")/.."
L=$(mktemp -d "${TMPDIR:-/tmp}/b5-logs.XXXXXX")
for c in default aggressive; do for n in 200 500 1000; do bench/run-bench.sh $c $n > $L/$c-$n.log 2>&1; done; done
WAL_ATTR=1 bench/run-bench.sh default 1000 > $L/walattr.log 2>&1
echo "logs in $L"

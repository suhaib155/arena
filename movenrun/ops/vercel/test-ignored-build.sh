#!/bin/bash
# Fixture tests for ignored-build.sh. Run: bash movenrun/ops/vercel/test-ignored-build.sh
# Builds throwaway git repos under a temp dir; touches nothing else.
SRC="$(cd "$(dirname "$0")" && pwd)/ignored-build.sh"
B=$(mktemp -d); trap 'rm -rf "$B"' EXIT; cd "$B" || exit 1
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@t GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@t
S=movenrun/ops/vercel/ignored-build.sh   # path inside the fixture repo
fail=0
mk(){ rm -rf r; git init -q -b main r; cd r || exit 1
 mkdir -p movenrun/website movenrun/backend movenrun/mobile movenrun/docs movenrun/ops/vercel
 echo '{}' >movenrun/website/vercel.json; echo '{}' >movenrun/website/package.json
 echo a >movenrun/website/index.html; echo a >movenrun/website/extra.html
 echo a >movenrun/backend/a.ts; echo a >movenrun/mobile/a.ts; echo a >movenrun/docs/a.md
 cp "$SRC" "$S"; git add -A; git commit -qm base; BASE=$(git rev-parse HEAD); }
c(){ git add -A; git commit -qm "$1"; }
check(){ # name expected actual
 local r=FAIL; [ "$2" = "$3" ] && r=PASS; [ $r = PASS ] || fail=1
 printf '| %s | %s | %s | %s |\n' "$1" "$2" "$3" "$r"; }
run(){ # name expected prev [extra env assignments...]; runs as Vercel does: cwd = website folder
 local n=$1 e=$2 p=$3; shift 3
 (cd movenrun/website && env "$@" VERCEL_GIT_PREVIOUS_SHA="$p" VERCEL_GIT_COMMIT_SHA=$(git rev-parse HEAD) sh ../ops/vercel/ignored-build.sh >/dev/null 2>&1); check "$n" "$e" $?; cd "$B"; }
echo '| case | expected | actual | result |'; echo '|---|---|---|---|'
mk; echo b>movenrun/website/index.html; c x; run "website-only" 1 $BASE
mk; echo b>movenrun/backend/a.ts; c x; run "backend-only" 0 $BASE
mk; echo b>movenrun/mobile/a.ts; c x; run "mobile-only" 0 $BASE
mk; echo b>movenrun/docs/a.md; c x; run "docs-only" 0 $BASE
mk; echo '{"a":1}'>movenrun/website/package.json; c x; run "website/package.json change" 1 $BASE
mk; echo '{"a":1}'>movenrun/website/vercel.json; c x; run "vercel.json config change" 1 $BASE
mk; echo b>movenrun/website/index.html; c w; echo b>movenrun/backend/a.ts; c b; run "multi-commit website+backend" 1 $BASE
mk; echo b>movenrun/website/index.html; c w; echo b>movenrun/backend/a.ts; c b; echo c>movenrun/website/index.html; c w2; echo d>movenrun/backend/a.ts; c b2; run "multi-commit, website change in middle" 1 $BASE
mk; echo b>movenrun/backend/a.ts; c b1; echo c>movenrun/docs/a.md; c d1; run "multi-commit backend+docs" 0 $BASE
mk; git checkout -qb feat; echo b>movenrun/website/index.html; c w; git checkout -q main; echo b>movenrun/backend/a.ts; c b; git merge -q --no-ff feat -m merge; run "merge commit bringing website change" 1 $BASE
mk; git checkout -qb feat; echo b>movenrun/backend/a.ts; c b; git checkout -q main; echo b>movenrun/mobile/a.ts; c m; git merge -q --no-ff feat -m merge; run "merge commit, unrelated only" 0 $BASE
mk; echo b>movenrun/backend/a.ts; c b; run "first build, no previous SHA" 1 ""
mk; echo b>movenrun/backend/a.ts; c b; run "previous SHA unreachable" 1 deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
mk; run "redeploy prev==current (equal SHAs)" 1 $BASE
mk; for i in $(seq 1 12); do echo $i>movenrun/backend/a.ts; c n$i; done; FAR=$BASE
cd "$B"; rm -rf sh; git clone -q --depth=3 file://$B/r sh; cd sh
(cd movenrun/website && VERCEL_GIT_PREVIOUS_SHA=$FAR VERCEL_GIT_COMMIT_SHA=$(git rev-parse HEAD) sh ../ops/vercel/ignored-build.sh >/dev/null 2>&1); check "shallow clone, prev missing" 1 $?
P=$(git rev-parse HEAD~2); (cd movenrun/website && VERCEL_GIT_PREVIOUS_SHA=$P VERCEL_GIT_COMMIT_SHA=$(git rev-parse HEAD) sh ../ops/vercel/ignored-build.sh >/dev/null 2>&1); check "shallow clone, prev present, backend-only" 0 $?
cd "$B"; rm -rf nogit; mkdir -p nogit/movenrun/ops/vercel nogit/movenrun/website; cp "$SRC" nogit/$S
(cd nogit/movenrun/website && sh ../ops/vercel/ignored-build.sh >/dev/null 2>&1); check "not a git repo" 1 $?
# New cases
mk; echo b>movenrun/backend/a.ts; c x; run "override VERCEL_FORCE_BUILD=1 on backend-only" 1 $BASE VERCEL_FORCE_BUILD=1
mk; echo b>movenrun/backend/a.ts; c x; run "VERCEL_FORCE_BUILD=0 does not force" 0 $BASE VERCEL_FORCE_BUILD=0
mk; echo b>movenrun/backend/a.ts; c x; run "VERCEL_FORCE_BUILD empty does not force" 0 $BASE VERCEL_FORCE_BUILD=
mk; git rm -q movenrun/website/extra.html; c x; run "removed website file" 1 $BASE
mk; echo b>movenrun/ops/vercel/note.txt; c x; run "ops-only change (script folder) skips" 0 $BASE
mk; echo '# changed'>>$S; c x; run "script itself edited, website untouched" 0 $BASE
mk; echo b>movenrun/backend/a.ts; c x; (cd movenrun && VERCEL_GIT_PREVIOUS_SHA=$BASE VERCEL_GIT_COMMIT_SHA=$(git rev-parse HEAD) sh ops/vercel/ignored-build.sh >/dev/null 2>&1); check "relocated script, started from movenrun/ (cwd-independent)" 0 $?; cd "$B"
mk; echo b>movenrun/website/index.html; c x; (cd / && VERCEL_GIT_PREVIOUS_SHA=$BASE VERCEL_GIT_COMMIT_SHA=$(git -C "$B/r" rev-parse HEAD) sh "$B/r/$S" >/dev/null 2>&1); check "relocated script, started from / (website changed)" 1 $?; cd "$B"
mk; rm -rf movenrun/website; echo b>movenrun/backend/a.ts; c x; (cd movenrun && VERCEL_GIT_PREVIOUS_SHA=$BASE VERCEL_GIT_COMMIT_SHA=$(git rev-parse HEAD) sh ops/vercel/ignored-build.sh >/dev/null 2>&1); check "website folder missing in checkout" 1 $?; cd "$B"
mk; echo b>movenrun/backend/a.ts; c x; run "extra watch path changed" 1 $BASE IGNORED_BUILD_EXTRA_WATCH=../backend
[ $fail = 0 ] && echo "ALL PASS" || { echo "FAILURES"; exit 1; }

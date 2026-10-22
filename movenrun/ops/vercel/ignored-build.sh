#!/bin/sh
# Vercel "Ignored Build Step" for the movenrun-website project.
# Lives OUTSIDE movenrun/website on purpose: the site's Output Directory is
# ".", so anything inside that folder is deployed and publicly served.
# Dashboard command (Root Directory movenrun/website): sh ../ops/vercel/ignored-build.sh
# Exit 0 = skip the build, exit 1 = build. Fails open: any doubt builds.
# Read-only git commands only; no network, no writes.
#
# Manual override: set VERCEL_FORCE_BUILD=1 (project env var, or in the
# environment of the run) to force a build.
#
# Watched: everything under movenrun/website (includes vercel.json). The site
# is static and imports nothing from outside its folder. To watch more, set
# IGNORED_BUILD_EXTRA_WATCH (paths relative to movenrun/website, e.g. ../shared).

build() { echo "ignored-build: BUILD - $1"; exit 1; }
skip()  { echo "ignored-build: SKIP - $1"; exit 0; }

[ -z "${VERCEL_FORCE_BUILD:-}" ] || [ "${VERCEL_FORCE_BUILD:-}" = "0" ] \
  || build "VERCEL_FORCE_BUILD is set"

command -v git >/dev/null 2>&1 || build "git not available"

# Always diff the website folder, wherever the step was started from.
SITE=$(cd "$(dirname "$0")/../../website" 2>/dev/null && pwd) \
  || build "website folder not found relative to script"
cd "$SITE" || build "cannot enter website folder"
WATCH=". ${IGNORED_BUILD_EXTRA_WATCH:-}"

git rev-parse --git-dir >/dev/null 2>&1 || build "not inside a git work tree"

PREV="${VERCEL_GIT_PREVIOUS_SHA:-}"
CUR="${VERCEL_GIT_COMMIT_SHA:-HEAD}"

[ -n "$PREV" ] || build "no previous SHA (first build of this branch)"
git cat-file -e "${PREV}^{commit}" 2>/dev/null \
  || build "previous SHA $PREV not present in clone (shallow or rewritten history)"
git cat-file -e "${CUR}^{commit}" 2>/dev/null || build "current commit $CUR not found"

PREV_FULL=$(git rev-parse "${PREV}^{commit}") || build "cannot resolve previous SHA"
CUR_FULL=$(git rev-parse "${CUR}^{commit}") || build "cannot resolve current SHA"
[ "$PREV_FULL" != "$CUR_FULL" ] || build "previous SHA equals current SHA (redeploy)"

# Tree-to-tree diff between the last deployed commit and this one. It covers
# multi-commit pushes and merge commits as a whole and does not depend on
# parent links, so a shallow clone is fine as long as both commits exist.
# shellcheck disable=SC2086
git diff --quiet "$PREV_FULL" "$CUR_FULL" -- $WATCH
rc=$?
case $rc in
  0) skip "no changes under website folder between $PREV_FULL and $CUR_FULL" ;;
  1) build "website inputs changed between $PREV_FULL and $CUR_FULL" ;;
  *) build "git diff failed (exit $rc)" ;;
esac

#!/usr/bin/env bash
# Move a GenOffice checkout to its latest release tag and re-apply the
# Obsidian patch. Safe to run repeatedly (and from a timer): it does nothing
# when already up to date, and if the patch does not fit a new release it
# puts the checkout back on the release it was on.
#
#   scripts/update-genoffice.sh [path-to-genoffice]     (default: ~/genoffice)
#
# Environment: SKIP_NPM=1 skips `npm install` (for testing).
set -euo pipefail

PLUGIN_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GENOFFICE_DIR="$(cd "${1:-$HOME/genoffice}" && pwd)"
PATCH="$PLUGIN_DIR/integration/genoffice.patch"
GIT_DIR_ABS="$(git -C "$GENOFFICE_DIR" rev-parse --absolute-git-dir)"
APPLIED="$GIT_DIR_ABS/obsidian-applied.patch"
STATE="$GIT_DIR_ABS/obsidian-release"

log() { printf '[genoffice-update] %s\n' "$*"; }
die() { log "ERROR: $*"; exit 1; }
go() { git -C "$GENOFFICE_DIR" "$@"; }

# 1. latest plugin code (patch fixes come with it)
if git -C "$PLUGIN_DIR" remote get-url origin >/dev/null 2>&1; then
  git -C "$PLUGIN_DIR" pull --ff-only -q || log "could not update the plugin repo; using the local copy"
fi

# 2. newest GenOffice release
go fetch -q --tags origin || die "could not reach GitHub"
LATEST="$(go tag -l 'v*' --sort=-version:refname | head -n1)"
[ -n "$LATEST" ] || die "no release tags found"
CURRENT="$(cat "$STATE" 2>/dev/null || true)"

if [ "$CURRENT" = "$LATEST" ] && [ -f "$APPLIED" ] && cmp -s "$PATCH" "$APPLIED"; then
  log "already on $LATEST with the current patch"
  exit 0
fi
log "updating to $LATEST (was: ${CURRENT:-$(go describe --tags --always)})"

# 3. take the old patch out: the copy this script applied, else the repo's
#    current patch, else any earlier version of it (applied by hand)
OLD=""
CANDIDATES="$(mktemp -d)"
trap 'rm -rf "$CANDIDATES"' EXIT
[ -f "$APPLIED" ] && cp "$APPLIED" "$CANDIDATES/0.patch"
cp "$PATCH" "$CANDIDATES/1.patch"
n=2
for rev in $(git -C "$PLUGIN_DIR" log --format=%H -- integration/genoffice.patch 2>/dev/null); do
  git -C "$PLUGIN_DIR" show "$rev:integration/genoffice.patch" > "$CANDIDATES/$n.patch" 2>/dev/null || continue
  n=$((n + 1))
done
for candidate in $(ls "$CANDIDATES" | sort -n); do
  if go apply -R --check "$CANDIDATES/$candidate" 2>/dev/null; then
    OLD="$CANDIDATES/$candidate"
    break
  fi
done
if [ -n "$OLD" ]; then
  go apply -R "$OLD"
elif go apply --check "$PATCH" 2>/dev/null || [ -z "$(go status --porcelain --untracked-files=no -- apps/markdown)" ]; then
  : # patch not applied at all
else
  die "the GenOffice checkout has changes this script did not make; commit or discard them first"
fi
# npm install rewrites the lockfile for the added dependency
go checkout -q -- package-lock.json 2>/dev/null || true
if [ -n "$(go status --porcelain --untracked-files=no)" ]; then
  CHANGES="$(go status --short --untracked-files=no | head -5 | tr '\n' ' ')"
  [ -n "$OLD" ] && go apply "$OLD" # leave GenOffice as it was: patched
  die "the GenOffice checkout has other local changes, so it was left on its current release: $CHANGES"
fi
PREVIOUS="$(go rev-parse HEAD)"

# 4. switch release and re-apply, rolling back if it does not fit
go checkout -q --detach "$LATEST"
if ! go apply --check "$PATCH" 2>/dev/null; then
  go checkout -q --detach "$PREVIOUS"
  [ -n "$OLD" ] && go apply "$OLD"
  die "the patch does not apply to $LATEST yet; staying on the previous release. Update the plugin repo, then run this again."
fi
go apply "$PATCH"
cp "$PATCH" "$APPLIED"

# 5. dependencies (also fetches the current plugin from GitHub). The release is
#    recorded only after this works, so a failed install is retried next run.
if [ "${SKIP_NPM:-}" != 1 ]; then
  (cd "$GENOFFICE_DIR" && npm install --no-audit --no-fund) ||
    die "npm install failed; it will be retried on the next run (or run it by hand in $GENOFFICE_DIR)"
fi
echo "$LATEST" > "$STATE"
log "done: GenOffice $LATEST with the Obsidian patch. Start it with: cd $GENOFFICE_DIR && npm run dev"

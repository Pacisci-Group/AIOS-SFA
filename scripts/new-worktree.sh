#!/usr/bin/env bash
#
# Create a fully-provisioned git worktree for parallel agent work.
#
# A plain `git worktree add` only materialises tracked files, so it is missing
# everything this repo actually needs to run: .env, the three read-only
# reference symlinks (SFA / agencyops_fe_mockups / sfaforms) that the
# .claude/rules/* files depend on, node_modules, and .claude/settings.local.json.
# This script adds all of them, and assigns the worktree its own API port, web
# port and Mongo database so parallel agents cannot clobber each other.
#
# Usage:
#   scripts/new-worktree.sh <branch> [base-branch] [--slot N] [--npm-install]
#
# Examples:
#   scripts/new-worktree.sh asad/pac-10-sold-scorecard
#   scripts/new-worktree.sh asad/pac-13-leaderboard dev --slot 3
#
# Remove one when done:
#   git worktree remove ../AIOS-SFA-worktrees/<slug> && git branch -d <branch>

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKTREE_HOME="$(dirname "$REPO_ROOT")/AIOS-SFA-worktrees"

BRANCH=""
BASE="dev"
SLOT=""
FORCE_NPM_INSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --slot)        SLOT="$2"; shift 2 ;;
    --npm-install) FORCE_NPM_INSTALL=1; shift ;;
    -h|--help)     sed -n '2,25p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *)
      if   [[ -z "$BRANCH" ]]; then BRANCH="$1"
      else BASE="$1"
      fi
      shift ;;
  esac
done

[[ -n "$BRANCH" ]] || { echo "usage: $0 <branch> [base-branch] [--slot N] [--npm-install]" >&2; exit 1; }

SLUG="$(echo "$BRANCH" | sed -E 's#^[^/]+/##; s#[^a-zA-Z0-9]+#-#g' | tr '[:upper:]' '[:lower:]')"
WT="$WORKTREE_HOME/$SLUG"

[[ -e "$WT" ]] && { echo "error: $WT already exists" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Slot -> ports + database name. Slot 1 => API 4100 / web 5273 / db sfa_wt1.
# Auto-picks the lowest slot not already claimed by an existing worktree.
# ---------------------------------------------------------------------------
if [[ -z "$SLOT" ]]; then
  SLOT=1
  while [[ -e "$WORKTREE_HOME/.slot-$SLOT" ]]; do SLOT=$((SLOT + 1)); done
fi
API_PORT=$((4000 + SLOT * 100))
WEB_PORT=$((5173 + SLOT * 100))
DB_NAME="sfa_wt${SLOT}"

echo "==> branch   $BRANCH  (base: $BASE)"
echo "==> path     $WT"
echo "==> slot $SLOT: api :$API_PORT  web :$WEB_PORT  db $DB_NAME"

mkdir -p "$WORKTREE_HOME"

# ---------------------------------------------------------------------------
# 1. The worktree itself
# ---------------------------------------------------------------------------
git -C "$REPO_ROOT" fetch --quiet origin "$BASE" 2>/dev/null || true
if git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$BRANCH"; then
  git -C "$REPO_ROOT" worktree add "$WT" "$BRANCH"
else
  BASE_REF="$BASE"
  git -C "$REPO_ROOT" show-ref --verify --quiet "refs/heads/$BASE" || BASE_REF="origin/$BASE"
  git -C "$REPO_ROOT" worktree add -b "$BRANCH" "$WT" "$BASE_REF"
fi

# ---------------------------------------------------------------------------
# 2. Read-only reference checkouts. The originals are RELATIVE symlinks
#    (SFA -> ../SFA); we write ABSOLUTE ones so the worktree can live anywhere.
# ---------------------------------------------------------------------------
for name in SFA agencyops_fe_mockups sfaforms; do
  target="$(cd "$REPO_ROOT/$name" 2>/dev/null && pwd -P || true)"
  if [[ -n "$target" ]]; then
    ln -s "$target" "$WT/$name"
    echo "    linked $name -> $target"
  else
    echo "    WARNING: $REPO_ROOT/$name is missing or dangling — agents will lose that reference" >&2
  fi
done

# ---------------------------------------------------------------------------
# 3. .env, rewritten for this slot's ports + database
# ---------------------------------------------------------------------------
if [[ -f "$REPO_ROOT/.env" ]]; then
  sed -E \
    -e "s#^(MONGODB_URI=.*/)sfa([?].*)?\$#\1${DB_NAME}\2#" \
    -e "s#^PORT=.*#PORT=${API_PORT}#" \
    -e "s#^CORS_ORIGIN=.*#CORS_ORIGIN=http://localhost:${WEB_PORT}#" \
    "$REPO_ROOT/.env" > "$WT/.env"
  {
    echo ""
    echo "# --- worktree slot ${SLOT} (scripts/new-worktree.sh) ---"
    echo "WEB_PORT=${WEB_PORT}"
    echo "VITE_API_PROXY_TARGET=http://localhost:${API_PORT}"
  } >> "$WT/.env"
  echo "    wrote .env (PORT=$API_PORT, db=$DB_NAME, web=$WEB_PORT)"
else
  echo "    WARNING: no .env at repo root to copy" >&2
fi

# ---------------------------------------------------------------------------
# 4. Claude Code machine-local settings (keeps the approved-permission list)
# ---------------------------------------------------------------------------
if [[ -f "$REPO_ROOT/.claude/settings.local.json" ]]; then
  mkdir -p "$WT/.claude"
  cp "$REPO_ROOT/.claude/settings.local.json" "$WT/.claude/settings.local.json"
  echo "    copied .claude/settings.local.json"
fi

# ---------------------------------------------------------------------------
# 5. node_modules. On APFS `cp -c` clones blocks copy-on-write: near-instant,
#    ~no extra disk. The npm-workspace links inside (@sfa/api -> ../../packages/api)
#    are relative, so they re-resolve correctly inside the worktree.
# ---------------------------------------------------------------------------
if [[ $FORCE_NPM_INSTALL -eq 0 && -d "$REPO_ROOT/node_modules" ]] \
   && cp -Rc "$REPO_ROOT/node_modules" "$WT/node_modules" 2>/dev/null; then
  echo "    cloned node_modules (copy-on-write)"
else
  rm -rf "$WT/node_modules"
  echo "    running npm install (this takes a minute)..."
  (cd "$WT" && npm install)
fi

touch "$WORKTREE_HOME/.slot-$SLOT"
echo "$SLUG" > "$WORKTREE_HOME/.slot-$SLOT"

cat <<EOF

Ready. Start an agent in it with:

  cd "$WT" && claude

Inside that worktree:
  npm run api:dev            -> http://localhost:${API_PORT}
  npm run web:dev            -> http://localhost:${WEB_PORT}
  npm run api:seed:demo:dev  -> seeds database '${DB_NAME}' only

Tear down when the branch is merged:
  git worktree remove "$WT" && rm -f "$WORKTREE_HOME/.slot-$SLOT"
EOF

#!/usr/bin/env bash
#
# Full data bring-up for a fresh SFA database, in dependency order.
#
# Three steps: seed the tenant, import the CRM, import the mailer history.
# Every step is idempotent and re-runnable, so a failed run is resumed with
# `--from <n>` rather than restarted. Each step's output is teed to a timestamped
# log directory — the SmartSuite migration's reconciliation report is the only
# record of what actually landed, and it scrolls off a terminal.
#
# It used to be seven. The other four were repair passes for databases migrated
# by older code, and a run against real data showed what they were worth:
# `backfill:deal-refs` found every ref already written by the migration and did
# real work on exactly one field (`policies.policyNumberKey`, now written by the
# migration itself); `fix:dedupe-indexes` reported `rebuilt=0`;
# `migrate:permissions` converted 0 users; and `sync:roles` re-ran the role
# seeding the core seed had already done. They are gone — `sync:roles` survives
# as a standalone tool for pushing a template change to existing tenants, which
# is the one job a fresh bring-up does not need.
#
#   ./scripts/migration/run-migration.sh --mode dev            # local, ts-node
#   ./scripts/migration/run-migration.sh --mode dist           # local, compiled
#   ./scripts/migration/run-migration.sh --mode compose        # on the droplet
#   ./scripts/migration/run-migration.sh --dry-run             # steps 2 + 3 fetch and report, no writes
#   ./scripts/migration/run-migration.sh --from 2              # resume after a failure
#   ./scripts/migration/run-migration.sh --only 2              # one step
#   ./scripts/migration/run-migration.sh --skip 3              # e.g. no BigQuery credentials
#   ./scripts/migration/run-migration.sh --mailer-limit 500    # cap step 3 for a smoke test
#
# ── Why a script and not a `&&` chain ───────────────────────────────────────
# The SmartSuite import walks ~20 tables and the mailer import ~671k rows. A
# one-liner gives no checkpoint (a failure at step 6 re-runs both slow imports),
# no per-step log, and no preflight — you would discover a missing credential
# after the seed had already written. This gives all three.
#
# ── Modes ───────────────────────────────────────────────────────────────────
#   dev      npm run <script>:dev   — ts-node against src. Local only.
#   dist     npm run <script>       — the compiled dist/ bundles. Local; proves
#            the artifact a server actually runs, which ts-node cannot.
#   compose  docker compose -f docker-compose.prod.yml run --rm api node dist/…
#            Run this ON the droplet, from /opt/sfa.
#
# ── Why `compose` rather than running from a laptop ─────────────────────────
#   1. `packages/api/src/config/env.config.ts` resolves ENV_FILE_PATH to the
#      repo-root `.env`, with no override. Real process env wins over it
#      (@nestjs/config merges process.env last), but anything you forget to
#      override silently keeps its LOCAL value — STORAGE_* still pointing at
#      MinIO, APP_BASE_URL still http://localhost:5173, and SEED_SUPER_ADMIN_*
#      still the dev password, which step 1 would then write to the real super
#      admin. The container carries no repo `.env`, so /opt/sfa/.env is the only
#      source and that entire class of mistake cannot happen.
#   2. Production's Managed Mongo admits nothing but the droplet
#      (`mongo_allowed_ip_addresses = []` in
#      infra/terraform/environments/presets/production.tfvars). Reaching it from
#      a laptop means opening the database perimeter on a cluster holding real
#      client data.
#   3. The image is node:22-alpine and has no bash, so this script cannot run
#      *inside* the container either. In `compose` mode the droplet's own bash
#      drives one container per step.
#
#   scp scripts/migration/run-migration.sh deploy@<host>:/opt/sfa/
#   ssh deploy@<host>
#   cd /opt/sfa
#   export SMARTSUITE_API_TOKEN=... SMARTSUITE_ACCOUNT_ID=... SMARTSUITE_SOLUTION_ID=...
#   export BQ_PROJECT_ID=... BQ_DATASET_ID=... BQ_MAILERS_TABLE_ID=...
#   export GOOGLE_APPLICATION_CREDENTIALS_JSON="$(cat sa.json)"
#   ./run-migration.sh --mode compose --dry-run     # rehearse first
#   ./run-migration.sh --mode compose
#
# The SmartSuite and BigQuery credentials are exported for the run rather than
# added to /opt/sfa/.env on purpose: the deploy workflow rewrites that file in
# full on every deploy, so anything put there is lost, and these are read-only
# source credentials the running API has no reason to hold.

set -euo pipefail

MODE=dev
DRY_RUN=""
FROM=1
ONLY=""
SKIP=""
MAILER_LIMIT=""
COMPOSE_FILE=docker-compose.prod.yml

while [ $# -gt 0 ]; do
  case "$1" in
    --mode)         MODE="$2"; shift 2 ;;
    --dry-run)      DRY_RUN=1; shift ;;
    --from)         FROM="$2"; shift 2 ;;
    --only)         ONLY="$2"; shift 2 ;;
    --skip)         SKIP="${SKIP:+$SKIP,}$2"; shift 2 ;;
    --mailer-limit) MAILER_LIMIT="$2"; shift 2 ;;
    --compose-file) COMPOSE_FILE="$2"; shift 2 ;;
    -h|--help)      sed -n '2,73p' "$0"; exit 0 ;;
    *) echo "unknown argument: $1" >&2; exit 2 ;;
  esac
done

case "$MODE" in
  dev|dist|compose) ;;
  *) echo "--mode must be dev, dist or compose" >&2; exit 2 ;;
esac

if [ "$MODE" = compose ]; then
  ROOT="$PWD"
else
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
  cd "$ROOT"
fi

LOG_DIR="$ROOT/migration-logs/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"

# Mirror how the scripts themselves resolve config, or the preflight would
# disagree with them: env.config.ts loads the repo-root `.env`, and
# @nestjs/config merges process.env OVER it. So take any key not already
# exported from that file — never the other way round. In compose mode the
# container reads /opt/sfa/.env itself, so only the pass-through credentials
# below are checked here.
if [ "$MODE" != compose ] && [ -f "$ROOT/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      ''|\#*) continue ;;
      *=*) ;;
      *) continue ;;
    esac
    key="${line%%=*}"
    case "$key" in
      *[!A-Za-z0-9_]*|'') continue ;;
    esac
    eval "current=\${$key:-}"
    [ -n "$current" ] && continue
    value="${line#*=}"
    value="${value%\"}"; value="${value#\"}"
    export "$key=$value"
  done < "$ROOT/.env"
fi

# ── Preflight: fail before the first write, not halfway through ─────────────
step_will_run() {
  n="$1"
  [ -n "$ONLY" ] && [ "$ONLY" != "$n" ] && return 1
  [ -z "$ONLY" ] && [ "$n" -lt "$FROM" ] && return 1
  case ",$SKIP," in *",$n,"*) return 1 ;; esac
  return 0
}

missing=""
require() { eval "v=\${$1:-}"; [ -n "$v" ] || missing="$missing $1"; }

# In compose mode MONGODB_URI lives in /opt/sfa/.env, which the container reads
# and this shell does not — checking it here would be a false failure.
[ "$MODE" != compose ] && require MONGODB_URI
if step_will_run 2; then
  require SMARTSUITE_API_TOKEN
  require SMARTSUITE_ACCOUNT_ID
  require SMARTSUITE_SOLUTION_ID
fi
if step_will_run 3; then
  require BQ_PROJECT_ID
  require BQ_DATASET_ID
  require GOOGLE_APPLICATION_CREDENTIALS_JSON
fi

if [ -n "$missing" ]; then
  echo "Preflight failed — these must be set in the environment:" >&2
  for m in $missing; do echo "  $m" >&2; done
  echo >&2
  echo "Skip the steps that need them with --skip 2 --skip 3, or export them." >&2
  exit 1
fi

# Credentials forwarded into the one-shot container. `-e NAME` with no value
# forwards this shell's value, so nothing is written to disk or into the
# process listing.
PASSTHROUGH="SMARTSUITE_API_TOKEN SMARTSUITE_ACCOUNT_ID SMARTSUITE_SOLUTION_ID \
SMARTSUITE_BASE_URL BQ_PROJECT_ID BQ_DATASET_ID BQ_MAILERS_TABLE_ID \
GOOGLE_APPLICATION_CREDENTIALS_JSON"

echo "mode=$MODE  dry-run=${DRY_RUN:-no}  from=$FROM  only=${ONLY:-all}  skip=${SKIP:-none}"
[ "$MODE" != compose ] && echo "mongo=$(printf '%s' "${MONGODB_URI:-}" | sed -E 's#//[^@]+@#//****@#')"
echo "logs=$LOG_DIR"
echo

run_step() {
  n="$1"; title="$2"; npm_script="$3"; dist_path="$4"; shift 4

  if ! step_will_run "$n"; then
    printf '  -  %d. %-34s skipped\n' "$n" "$title"
    return 0
  fi

  log="$LOG_DIR/$n-$(printf '%s' "$npm_script" | tr ':/' '--').log"
  printf '  >  %d. %-34s ' "$n" "$title"
  start=$(date +%s)

  set +e
  if [ "$MODE" = compose ]; then
    env_flags=""
    for name in $PASSTHROUGH; do
      eval "v=\${$name:-}"
      [ -n "$v" ] && env_flags="$env_flags -e $name"
    done
    # shellcheck disable=SC2086
    docker compose -f "$COMPOSE_FILE" run --rm --no-deps \
      $env_flags \
      -e MIGRATION_REPORT_PATH=/app/migration-out/migration-report.json \
      -v "$LOG_DIR:/app/migration-out" \
      api node "packages/api/dist/$dist_path.js" "$@" >"$log" 2>&1
  else
    suffix=""; [ "$MODE" = dev ] && suffix=":dev"
    npm run "${npm_script}${suffix}" -w @sfa/api -- "$@" >"$log" 2>&1
  fi
  status=$?
  set -e

  if [ $status -eq 0 ]; then
    printf 'ok (%ss)\n' "$(( $(date +%s) - start ))"
  else
    printf 'FAILED (%ss)\n\n' "$(( $(date +%s) - start ))"
    echo "--- tail of $log ---" >&2
    tail -40 "$log" >&2
    echo >&2
    echo "Fix, then resume with: $0 --mode $MODE --from $n" >&2
    exit 1
  fi
}

# ── Steps, in dependency order ──────────────────────────────────────────────
#
# 1 must be first: the migration imports INTO the agency + branch scaffold the
#   core seed creates and resolves producers against its default roles. It also
#   creates the agency owner, which is the only login that can administer the
#   tenant afterwards (set SEED_AGENCY_OWNER_EMAIL / _PASSWORD).
# 2 is the SmartSuite import. It writes its own refs and match keys — there is
#   no follow-up repair pass to run.
# 3 needs only the agency ticker map from step 1, not step 2. Last because it is
#   the longest-running and the least coupled: a failure here leaves a complete
#   CRM dataset behind.

run_step 1 "Core seed (admin, scaffold, owner)" seed            seed/seed
run_step 2 "SmartSuite -> Mongo"                migrate         migration/migrate \
  ${DRY_RUN:+--dry-run}
run_step 3 "BigQuery -> mailers"                migrate:mailers migration/mailers/import-bigquery-mailers \
  ${DRY_RUN:+--dry-run} ${MAILER_LIMIT:+--limit} ${MAILER_LIMIT:+$MAILER_LIMIT}

echo
echo "Done. Logs in $LOG_DIR"
for report in "$LOG_DIR/migration-report.json" "$ROOT/migration-report.json"; do
  [ -f "$report" ] && echo "Reconciliation report: $report" && break
done

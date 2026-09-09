#!/usr/bin/env bash
#
# One-time upgrade of an EXISTING SFA database to the current code.
#
# For a database that was migrated before September 2026 — i.e. production, and
# any local restore of it. A fresh database needs none of this: it gets the
# current shape from `run-migration.sh` and the migrations at first boot.
#
# Seven steps. Four are one-shot scripts, two are migrate-mongo passes, and the
# order between them is load-bearing — see "Why this order" below. Every step is
# idempotent, so a failed run is resumed with `--from <n>` rather than restarted,
# and a completed run can be repeated safely.
#
#   ./scripts/migration/run-upgrade.sh --mode dev --dry-run      # rehearse locally
#   ./scripts/migration/run-upgrade.sh --mode dev --yes          # local, for real
#   ./scripts/migration/run-upgrade.sh --mode compose --dry-run  # rehearse on the droplet
#   ./scripts/migration/run-upgrade.sh --mode compose --yes      # production
#   ./scripts/migration/run-upgrade.sh --mode dev --from 4       # resume
#
# ⚠ DELETE THIS SCRIPT once every environment has run it. It exists to carry
# databases across one specific boundary; kept around it becomes a loaded gun
# pointed at a database that no longer needs it.
#
# ── WHEN TO RUN IT ──────────────────────────────────────────────────────────
#
# LOCAL — **before** starting the dev server, with the API and worker STOPPED.
#   `npm run api:dev` applies pending migrations at boot and would race this
#   script; it is also how a previous session recorded empty migration scaffolds
#   as applied, which cannot be undone without editing `migrations_changelog`.
#
#     (stop api:dev and the worker)
#     ./scripts/migration/run-upgrade.sh --mode dev --dry-run
#     ./scripts/migration/run-upgrade.sh --mode dev --yes
#     npm run api:dev            # only now
#
# PRODUCTION — **after** the new image is on the droplet but **before** the API
#   serves from it, with the api and worker services STOPPED. The image has to
#   be there first (steps 4 and 6 are new code), yet the API must not boot with
#   migrations on, or it applies step 5 before step 4 has run.
#
#     1. set DB_MIGRATE_ON_BOOT=false for the production Environment  (see ⚠ below)
#     2. merge dev -> main; the deploy builds and pushes the image
#     3. ssh to the droplet, cd /opt/sfa
#     4. docker compose -f docker-compose.prod.yml stop api worker
#     5. drop the three unique indexes the deploy's boot created (see below)
#     6. ./run-upgrade.sh --mode compose --dry-run     # read the reports
#     7. ./run-upgrade.sh --mode compose --yes
#     8. docker compose -f docker-compose.prod.yml up -d
#     9. set DB_MIGRATE_ON_BOOT back to true and re-run the deploy workflow
#
#   ⚠ `deploy.reusable.yml` rewrites /opt/sfa/.env in full on every deploy, so
#   DB_MIGRATE_ON_BOOT is read from the GitHub Environment *variable* of that
#   name and written into the file by the workflow; editing the file by hand
#   does not survive the deploy that the merge triggers. Left on, merging to
#   main boots the API with migrations: step 6 applies, step 7 throws on the
#   duplicates, and the container crash-loops against a half-migrated database.
#
#   ⚠ Step 5 is not a contingency. Migrations off or not, the deploy runs
#   `up -d` and a health check, and creating the Nest app fires `autoIndex`
#   over every schema - including the two contact identity indexes and the
#   household primary-contact index, which are declared on the schemas as well
#   as built by migrations. All three build fine over the *old* data (no
#   contact has keys yet, only two households have a primary) and then sit
#   there as loaded guns for steps 1 and 2. The preflight below refuses while
#   any of them exists ahead of its migration, and prints the drop commands.
#
# ── WHY THIS ORDER ──────────────────────────────────────────────────────────
#
#   1   fills the household links. It MUST precede 3: the duplicate merge keeps
#       "the row with a household link", and before the backfill only 35% of
#       contacts had one, so the winner would be near-random.
#   2   converts contacts to scalars and stamps the identity keys the merge
#       compares on, then STOPS at the identity-index wall. That stop is by
#       design and this script expects it — see `expect_wall`.
#   3   merges the duplicate contacts the wall named. It deletes people, which
#       is why its report is the review gate.
#   4   applies the rest, including the partial unique index that enforces
#       "primary of at most one household".
#
#   5-7 are independent of PAC-91, but NOT independent of *when* they run.
#
#       ⚠ Step 7 (`consolidate-service-tickets`) boots a Nest application
#       context, which compiles every Mongoose model and therefore fires
#       `autoIndex` across the whole database. Run before step 2 it silently
#       creates `agencyId_1_nameKey_1_dobKey_1_{phone,email}` — the two UNIQUE
#       identity indexes — over data that still holds 24 duplicate groups.
#       Migration 2 then dies mid-write on a raw E11000 instead of stopping at
#       its own wall, is never recorded, and retries from the top forever
#       against indexes that are still there. Measured on the production dump:
#       499 contacts stamped, then deadlock.
#
#       So every Mongoose-booting step goes AFTER the migrations, and step 6
#       (`mailer-campaigns`, which rebuilds a platform-wide unique index of its
#       own) goes before step 7 for exactly the same reason — see AGENTS.md.
#       Steps 5 and 6 use the raw driver and are order-insensitive among
#       themselves.
#
# ── MODES ───────────────────────────────────────────────────────────────────
#   dev      npm run <script>:dev  — ts-node against src. Local only.
#   dist     npm run <script>      — the compiled bundles. Local; proves the
#            artifact a server actually runs, which ts-node cannot.
#   compose  docker compose run --rm api node packages/api/dist/… — on the
#            droplet, from /opt/sfa. Same reasoning as `run-migration.sh`: the
#            container is the only place the real .env lives, and running from a
#            laptop means opening the database perimeter.

set -euo pipefail

MODE=dev
DRY_RUN=""
FROM=1
ONLY=""
SKIP=""
YES=""
AGENCY=smith-family-agency
CSV_DIR=""
CONTACTS_CSV=""
HOUSEHOLDS_CSV=""
POLICIES_CSV=""
COMPOSE_FILE=docker-compose.prod.yml

while [ $# -gt 0 ]; do
  case "$1" in
    --mode)          MODE="$2"; shift 2 ;;
    --dry-run)       DRY_RUN=1; shift ;;
    --yes)           YES=1; shift ;;
    --from)          FROM="$2"; shift 2 ;;
    --only)          ONLY="$2"; shift 2 ;;
    --skip)          SKIP="${SKIP:+$SKIP,}$2"; shift 2 ;;
    --agency)        AGENCY="$2"; shift 2 ;;
    --csv-dir)       CSV_DIR="$2"; shift 2 ;;
    --contacts)      CONTACTS_CSV="$2"; shift 2 ;;
    --households)    HOUSEHOLDS_CSV="$2"; shift 2 ;;
    --policies)      POLICIES_CSV="$2"; shift 2 ;;
    --compose-file)  COMPOSE_FILE="$2"; shift 2 ;;
    -h|--help)       sed -n '2,105p' "$0"; exit 0 ;;
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

LOG_DIR="$ROOT/upgrade-logs/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$LOG_DIR"

# Same rule as run-migration.sh: take from the repo .env only what is not
# already exported, because that is the precedence env.config.ts + @nestjs/config
# apply. In compose mode the container reads /opt/sfa/.env itself.
if [ "$MODE" != compose ] && [ -f "$ROOT/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in ''|\#*) continue ;; *=*) ;; *) continue ;; esac
    key="${line%%=*}"
    case "$key" in *[!A-Za-z0-9_]*|'') continue ;; esac
    eval "current=\${$key:-}"
    [ -n "$current" ] && continue
    value="${line#*=}"; value="${value%\"}"; value="${value#\"}"
    export "$key=$value"
  done < "$ROOT/.env"
fi

step_will_run() {
  n="$1"
  [ -n "$ONLY" ] && [ "$ONLY" != "$n" ] && return 1
  [ -z "$ONLY" ] && [ "$n" -lt "$FROM" ] && return 1
  case ",$SKIP," in *",$n,"*) return 1 ;; esac
  return 0
}

# ── Preflight: fail before the first write, not halfway through ─────────────

fail() { echo; echo "Preflight failed: $*" >&2; exit 1; }

[ "$MODE" != compose ] && [ -z "${MONGODB_URI:-}" ] && fail "MONGODB_URI is not set."

# The CSVs are gitignored and live only in the main checkout, so they have to be
# put on the droplet by hand. Resolve them by glob rather than by exact name:
# a re-export lands with a new date in the filename.
if step_will_run 1; then
  [ -z "$CSV_DIR" ] && CSV_DIR="$ROOT/temp"
  pick_csv() {
    label="$1"; pattern="$2"
    # shellcheck disable=SC2086
    set -- $CSV_DIR/$pattern
    [ -e "$1" ] || fail "no $label CSV matching '$pattern' in $CSV_DIR (pass --csv-dir, or --$label)."
    [ $# -gt 1 ] && fail "$# files match '$pattern' in $CSV_DIR — name one explicitly with --$label."
    printf '%s' "$1"
  }
  [ -z "$CONTACTS_CSV" ]   && CONTACTS_CSV="$(pick_csv contacts 'Contacts*.csv')"
  [ -z "$HOUSEHOLDS_CSV" ] && HOUSEHOLDS_CSV="$(pick_csv households 'Households*.csv')"
  [ -z "$POLICIES_CSV" ]   && POLICIES_CSV="$(pick_csv policies 'Policies*.csv')"
  for f in "$CONTACTS_CSV" "$HOUSEHOLDS_CSV" "$POLICIES_CSV"; do
    [ -r "$f" ] || fail "cannot read $f"
  done
fi

# ⚠ The trap webpack.config.js documents: a one-shot script that is not an entry
# there simply does not exist in the image, and `node dist/…` fails with
# MODULE_NOT_FOUND *after* earlier steps have already written. Check up front.
if [ "$MODE" = compose ]; then
  missing_entries=""
  for entry in \
    migration/consolidate-service-tickets \
    migration/backfill/allstate-id-to-carrier-appointment \
    migration/backfill/mailer-campaigns \
    migration/backfill/backfill-household-links \
    migration/backfill/merge-duplicate-contacts
  do
    if ! docker compose -f "$COMPOSE_FILE" run --rm --no-deps -T api \
        node -e "process.exit(require('fs').existsSync('packages/api/dist/$entry.js')?0:1)" \
        >/dev/null 2>&1; then
      missing_entries="$missing_entries $entry"
    fi
  done
  if [ -n "$missing_entries" ]; then
    echo "Preflight failed — these are missing from the image:" >&2
    for m in $missing_entries; do echo "  packages/api/dist/$m.js" >&2; done
    echo >&2
    echo "Add each to ONE_SHOT_ENTRIES in packages/api/webpack.config.js and" >&2
    echo "redeploy. The runner stage copies dist and never src, so a script" >&2
    echo "that is not an entry there cannot be run on a server." >&2
    exit 1
  fi

  # 6 rebuilds a platform-wide unique index and 1-4 rewrite what the API caches
  # and indexes. A live API or worker writing through either is how you get a
  # half-converted collection nobody can explain afterwards.
  running="$(docker compose -f "$COMPOSE_FILE" ps --services --status running 2>/dev/null || true)"
  for svc in api worker; do
    case "$running" in
      *"$svc"*) fail "the '$svc' service is running. Stop it first:
    docker compose -f $COMPOSE_FILE stop api worker" ;;
    esac
  done
fi

# ⚠ The state that deadlocks the whole upgrade, checked before the first write.
#
# The two UNIQUE identity indexes must NOT exist while the scalar/key migration
# is still pending. If they do — because a Nest-booting script or an `api:dev`
# has already touched this database and `autoIndex` created them — the migration
# stamps keys into a unique index over data that still holds duplicates, dies
# mid-write on a raw E11000, is never recorded, and retries from the top forever.
# The fix is to drop them; the migration builds them properly, after the merge.
#
# The same trap, one collection over: `agencyId_1_primaryContactId_1` on
# households. Step 1 fills ~2,400 primaries under it, and the migration that
# owns it treats an existing index as "already built" WITHOUT checking for
# conflicts - so a double primary that slipped in would fail step 1 on E11000
# (or, with the unordered bulk write, silently skip that household) instead of
# stopping migration 4 at its named wall.
IDENTITY_INDEX=agencyId_1_nameKey_1_dobKey_1_email_1
SCALARS_MIGRATION=20260907105040-contact-scalars-and-identity-keys.js
PRIMARY_INDEX=agencyId_1_primaryContactId_1
PRIMARY_MIGRATION=20260907172120-household-primary-contact-index.js

# Exit 3 = a unique index exists ahead of the migration that builds it (which
# ones is printed on stdout); 0 = clean; 4 = could not reach the database.
probe='const {MongoClient}=require("mongodb");(async()=>{
  const c=await MongoClient.connect(process.env.MONGODB_URI);
  const db=c.db();
  const applied=f=>db.collection("migrations_changelog").countDocuments({fileName:f});
  const has=async(col,name)=>(await db.collection(col).indexes()).some(i=>i.name===name);
  const early=[];
  if(!(await applied(process.env.SCALARS_MIGRATION)) && await has("contacts",process.env.IDENTITY_INDEX)) early.push("contacts");
  if(!(await applied(process.env.PRIMARY_MIGRATION)) && await has("households",process.env.PRIMARY_INDEX)) early.push("households");
  await c.close();
  console.log(early.join(" "));
  process.exit(early.length ? 3 : 0);
})().catch(e=>{console.error(e.message);process.exit(4);});'

set +e
if [ "$MODE" = compose ]; then
  probe_out="$(docker compose -f "$COMPOSE_FILE" run --rm --no-deps -T \
    -e IDENTITY_INDEX="$IDENTITY_INDEX" -e SCALARS_MIGRATION="$SCALARS_MIGRATION" \
    -e PRIMARY_INDEX="$PRIMARY_INDEX" -e PRIMARY_MIGRATION="$PRIMARY_MIGRATION" \
    api node -e "$probe" 2>/dev/null)"
else
  probe_out="$(IDENTITY_INDEX="$IDENTITY_INDEX" SCALARS_MIGRATION="$SCALARS_MIGRATION" \
    PRIMARY_INDEX="$PRIMARY_INDEX" PRIMARY_MIGRATION="$PRIMARY_MIGRATION" \
    node -e "$probe" 2>/dev/null)"
fi
probe_status=$?
set -e

if [ $probe_status -eq 3 ]; then
  cat >&2 <<EOF

Preflight failed: a unique index exists ahead of the migration that builds it
(on: $(printf '%s' "$probe_out" | tr -d '\r')).

Something booted Mongoose against this database first - the deploy's own
\`up -d\` (this is the expected case on the droplet), an \`api:dev\`, or a
Nest-booting one-shot - and autoIndex created the index over data the upgrade
has not converted yet. Left in place:
  - contacts:   migration 2 stamps identity keys into a unique index over
                data that still holds duplicates, dies mid-write on E11000,
                is never recorded, and retries forever;
  - households: step 1 fills primaries under a unique index, and migration 4
                then treats the existing index as done without checking for
                a double primary - the wall it exists to stop at.

Drop whichever exist and re-run; the migrations rebuild them after the merge:

  db.contacts.dropIndex("agencyId_1_nameKey_1_dobKey_1_email_1")
  db.contacts.dropIndex("agencyId_1_nameKey_1_dobKey_1_phone_1")
  db.households.dropIndex("agencyId_1_primaryContactId_1")

Without mongosh (on the droplet), the same through the image:

  docker compose -f $COMPOSE_FILE run --rm --no-deps -T api node -e '
    const {MongoClient}=require("mongodb");(async()=>{
      const c=await MongoClient.connect(process.env.MONGODB_URI);const db=c.db();
      for(const [col,name] of [["contacts","agencyId_1_nameKey_1_dobKey_1_email_1"],
                               ["contacts","agencyId_1_nameKey_1_dobKey_1_phone_1"],
                               ["households","agencyId_1_primaryContactId_1"]]){
        const has=(await db.collection(col).indexes()).some(i=>i.name===name);
        if(has){await db.collection(col).dropIndex(name);console.log("dropped",col,name)}
        else console.log("absent",col,name)}
      await c.close()})()'

If migration 2 already got partway through, also clear the half-written keys:

  db.contacts.updateMany({}, { \$unset: { nameKey: "", dobKey: "" } })
EOF
  exit 1
fi
[ $probe_status -ne 0 ] && fail "could not reach the database to run the preflight probe."

if [ -z "$DRY_RUN" ] && [ -z "$YES" ]; then
  echo "This writes to the database. Re-run with --dry-run first, then --yes." >&2
  exit 2
fi

# ── How each step is invoked, per mode ──────────────────────────────────────

# migrate-mongo is a CLI rather than an npm script in compose mode; the config
# path is all that matters, since migrationsDir inside it is absolute.
migrate_mongo() {
  verb="$1"
  if [ "$MODE" = compose ]; then
    docker compose -f "$COMPOSE_FILE" run --rm --no-deps -T api \
      npx migrate-mongo "$verb" -f packages/api/migrate-mongo-config.js
  else
    npm run "db:migrate$( [ "$verb" = status ] && echo :status )" -w @sfa/api
  fi
}

echo "mode=$MODE  dry-run=${DRY_RUN:-no}  agency=$AGENCY  from=$FROM  only=${ONLY:-all}  skip=${SKIP:-none}"
[ "$MODE" != compose ] && echo "mongo=$(printf '%s' "${MONGODB_URI:-}" | sed -E 's#//[^@]+@#//****@#')"
echo "logs=$LOG_DIR"
echo

# Set STEP_ALREADY_DONE before a call to name the refusal that means "this one
# has run before"; run_step clears it again.
STEP_ALREADY_DONE=""

run_step() {
  n="$1"; title="$2"; npm_script="$3"; dist_path="$4"; shift 4

  if ! step_will_run "$n"; then
    printf '  -  %d. %-40s skipped\n' "$n" "$title"
    return 0
  fi

  log="$LOG_DIR/$n-$(printf '%s' "$npm_script" | tr ':/' '--').log"
  printf '  >  %d. %-40s ' "$n" "$title"
  start=$(date +%s)

  set +e
  if [ "$MODE" = compose ]; then
    # The CSVs and the JSON reports both have to cross the container boundary.
    # Read-only in, writable out.
    # shellcheck disable=SC2086
    docker compose -f "$COMPOSE_FILE" run --rm --no-deps -T \
      -v "$LOG_DIR:/app/upgrade-out" \
      ${CSV_DIR:+-v "$CSV_DIR:/app/upgrade-in:ro"} \
      api node "packages/api/dist/$dist_path.js" "$@" >"$log" 2>&1
  else
    suffix=""; [ "$MODE" = dev ] && suffix=":dev"
    npm run "${npm_script}${suffix}" -w @sfa/api -- "$@" >"$log" 2>&1
  fi
  STATUS=$?
  set -e

  if [ $STATUS -eq 0 ]; then
    printf 'ok (%ss)\n' "$(( $(date +%s) - start ))"
    STEP_ALREADY_DONE=""
    return 0
  fi

  # A step that refuses because it has already run is not a failure — it is what
  # makes the whole script re-runnable, and a resume after a mid-sequence failure
  # depends on it. Matched on the guard's own wording rather than on any non-zero
  # exit, so a real error still stops everything.
  if [ -n "$STEP_ALREADY_DONE" ] && grep -q "$STEP_ALREADY_DONE" "$log"; then
    printf 'already applied — skipped (%ss)\n' "$(( $(date +%s) - start ))"
    STEP_ALREADY_DONE=""
    return 0
  fi

  printf 'FAILED (%ss)\n\n' "$(( $(date +%s) - start ))"
  echo "--- tail of $log ---" >&2
  tail -40 "$log" >&2
  echo >&2
  echo "Fix, then resume with: $0 --mode $MODE ${DRY_RUN:+--dry-run }${YES:+--yes }--from $n" >&2
  exit 1
}

# A migrate-mongo pass. `expect_wall` names a refusal that is part of the
# design rather than a failure: the migration checks for conflicting data and
# throws, and the very next step is the one that resolves it.
run_migrate() {
  n="$1"; title="$2"; expect_wall="${3:-}"

  if ! step_will_run "$n"; then
    printf '  -  %d. %-40s skipped\n' "$n" "$title"
    return 0
  fi

  log="$LOG_DIR/$n-db-migrate.log"
  printf '  >  %d. %-40s ' "$n" "$title"
  start=$(date +%s)

  if [ -n "$DRY_RUN" ]; then
    # There is no dry run for a migration. Report what is pending and move on,
    # rather than pretending the rehearsal covered it.
    migrate_mongo status >"$log" 2>&1 || true
    printf 'listed only (dry run)\n'
    return 0
  fi

  set +e
  migrate_mongo up >"$log" 2>&1
  STATUS=$?
  set -e

  if [ $STATUS -eq 0 ]; then
    printf 'ok (%ss)\n' "$(( $(date +%s) - start ))"
    return 0
  fi

  if [ -n "$expect_wall" ] && grep -q "$expect_wall" "$log"; then
    printf 'stopped at the wall, as designed (%ss)\n' "$(( $(date +%s) - start ))"
    return 0
  fi

  printf 'FAILED (%ss)\n\n' "$(( $(date +%s) - start ))"
  echo "--- tail of $log ---" >&2
  tail -40 "$log" >&2
  echo >&2
  if grep -q "primary of more than one household" "$log"; then
    cat >&2 <<'WALL'
This is the "primary of at most one household" wall, and it names the contacts
responsible. The three pairs known on 2026-09-09 are already resolved by the
merges in pac-91-owner-decisions.json, so a hit here means a NEW pair appeared
in this database since that list was written.

That is an OWNER DECISION, not something to force past: for each pair, either
merge the two households (add them to removeHouseholds with mergeMembers) or
keep both and name which household the contact leads. Nothing else in the
upgrade is blocked — every earlier step has already landed.
WALL
  fi
  echo "Fix, then resume with: $0 --mode $MODE ${YES:+--yes }--from $n" >&2
  exit 1
}

# In compose mode the paths the container sees differ from the ones on the host.
if [ "$MODE" = compose ]; then
  IN=/app/upgrade-in; OUT=/app/upgrade-out
  csv_arg() { printf '%s/%s' "$IN" "$(basename "$1")"; }
else
  OUT="$LOG_DIR"
  csv_arg() { printf '%s' "$1"; }
fi

# ── Steps ───────────────────────────────────────────────────────────────────

# Once `householdMembers` exists the backfill refuses by design: it writes the
# pre-membership link fields and belongs before the migration that seeds them.
STEP_ALREADY_DONE='already has `householdMembers` rows'
run_step 1 "PAC-91 household links + decisions" backfill:household-links \
  migration/backfill/backfill-household-links \
  --agency "$AGENCY" \
  --contacts "$(csv_arg "$CONTACTS_CSV")" \
  --households "$(csv_arg "$HOUSEHOLDS_CSV")" \
  --policies "$(csv_arg "$POLICIES_CSV")" \
  --apply-owner-decisions \
  --report "$OUT/1-household-links-report.json" \
  ${DRY_RUN:+--dry-run}

# Steps 2-4 have no rehearsal, and pretending otherwise fails confusingly:
# a migration has no dry run, and the merge groups by the `nameKey`/`dobKey`
# that step 2 stamps — run against an un-migrated database it refuses outright
# ("No contact carries nameKey/dobKey"), which reads as a broken script rather
# than as the ordering fact it is. So the dry run stops after step 1 and says
# what the only real rehearsal is: a live run against a restored copy.
if [ -n "$DRY_RUN" ]; then
  for pending in \
    "2. Migrations, pass 1 (to the wall)" \
    "3. Merge duplicate contacts" \
    "4. Migrations, pass 2 (the rest)"
  do
    printf '  -  %-43s not rehearsable — see below\n' "$pending"
  done
else
  run_migrate 2 "Migrations, pass 1 (to the wall)" "duplicate contact group(s) remain"

  run_step 3 "Merge duplicate contacts"           merge:duplicate-contacts \
    migration/backfill/merge-duplicate-contacts \
    --agency "$AGENCY" \
    --report "$OUT/3-contact-merge-report.json"

  run_migrate 4 "Migrations, pass 2 (the rest)"
fi

run_step 5 "Allstate id -> carrier appointment" backfill:appointments \
  migration/backfill/allstate-id-to-carrier-appointment \
  ${DRY_RUN:+--dry-run}

run_step 6 "Mailers -> campaign tenancy"        backfill:mailer-campaigns \
  migration/backfill/mailer-campaigns \
  ${DRY_RUN:+--dry-run}

# LAST, and the comment at the top explains why: this one boots Nest and
# autoIndex behind it.
run_step 7 "Consolidate service tickets"        migrate:tickets \
  migration/consolidate-service-tickets \
  ${DRY_RUN:+--dry-run}

# ── Verify ──────────────────────────────────────────────────────────────────

echo
if [ -n "$DRY_RUN" ]; then
  cat <<EOF
Dry run complete — steps 1, 5, 6 and 7 only. Nothing was written.

Read this before the real run; it is the first review gate:
  $LOG_DIR/1-household-links-report.json
Conflicts in it are REPORTED, never written — a stored value that disagrees
with the export is left alone. \`householdsRefused\` must be 0.

⚠ Steps 2-4 have no dry run, and it is not a gap in this script:
   - a migrate-mongo migration either applies or does not;
   - the contact merge groups by the identity keys step 2 stamps, so against an
     un-migrated database it has nothing to group by and refuses.

   Their only rehearsal is a LIVE run against a restored copy of production —
   which is what a local run against your imported dump is. Do that first, read
   the merge report it produces ($LOG_DIR/3-contact-merge-report.json — it
   deletes people), and only then run against production.

Then: $0 --mode $MODE --yes
EOF
  exit 0
fi

echo "Verifying migration state..."
status_log="$LOG_DIR/8-verify-status.log"
migrate_mongo status >"$status_log" 2>&1 || true
pending=$(grep -c PENDING "$status_log" || true)
sed -n '1,40p' "$status_log"

echo
if [ "$pending" -gt 0 ]; then
  echo "⚠ $pending migration(s) still PENDING — the upgrade is NOT complete."
  echo "  See $status_log, resolve, then re-run: $0 --mode $MODE --yes --from 2"
  exit 1
fi

cat <<EOF

Done — every migration applied. Logs and reports in:
  $LOG_DIR

What good looks like, from the reports:
  step 1  householdsRefused 0, and the re-run reports 0 fills
  step 3  0 dangling contact references across all seven ref sites
  step 4  "[PAC-91] built agencyId_1_primaryContactId_1"

Now bring the app back up — locally \`npm run api:dev\`; on the droplet
\`docker compose -f $COMPOSE_FILE up -d\`, then put DB_MIGRATE_ON_BOOT back to
true and re-run the deploy workflow.
EOF

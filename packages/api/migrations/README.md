# `migrations/` — versioned MongoDB migrations

Every `.js` file here runs **exactly once per database**, in filename order
(they are timestamp-prefixed, so that is chronological). What ran is recorded in
the `migrations_changelog` collection.

> ⚠ Not the same thing as `src/migration/`. That is the **one-time SmartSuite →
> Mongo data import** used to bring up a fresh database
> (`scripts/migration/run-migration.sh`). This directory is the **ongoing**
> system for changing a database that already has data in it.

## When you need one

Anything that must happen to data or indexes that already exist:

- **Changing the options of an existing index.** Mongoose's `autoIndex` only
  creates indexes that are *missing* — it never rebuilds one whose options
  changed. Editing the schema therefore fixes only collections created
  *afterwards* and silently leaves existing ones on the old definition.
- Backfilling a new required field on existing documents.
- Renaming or reshaping a field.
- Dropping a collection or index that is no longer used.

You do **not** need one to add a brand-new collection or a brand-new index —
`autoIndex` handles those.

## Workflow

```bash
npm run db:migrate:create -- add_archived_to_households   # scaffold from sample-migration.js
npm run db:migrate:status                                 # what has run, what is pending
npm run db:migrate                                        # apply everything pending
npm run db:migrate:down                                   # roll back the last one only
```

All four also exist scoped to the API workspace (`npm run db:migrate -w @sfa/api`
and friends); the root scripts are just passthroughs. They read `MONGODB_URI`
from the repo-root `.env`, same as the app.

## They also run automatically

The API applies pending migrations at startup, before it binds a port — see
`src/database/run-migrations.ts`. So in a deployed environment the normal path is
"merge and deploy", not "SSH in and run a script". Set `DB_MIGRATE_ON_BOOT=false`
to suppress that for one boot.

Concurrent boots are safe: replicas race for a lock document in
`migrations_lock`, one applies, and the rest wait for it before serving.

## Rules

1. **Applied migrations are immutable.** `useFileHash` is off, so editing a file
   that already ran changes nothing on any database where it ran. Fix a mistake
   with a *new* migration.
2. **Use the raw `db` handle, never a Mongoose model.** Importing a schema
   compiles a model and fires `autoIndex`, racing the very index the migration
   is usually there to rebuild.
3. **Be idempotent.** A migration that fails halfway is not recorded, so the next
   boot retries it from the top — it must tolerate finding its own partial work.
4. **Check before destroying.** Rebuilding a unique index over duplicate data
   fails, and failing *after* the drop leaves no uniqueness at all.
5. **Write `down`, or throw in it.** An empty `down` reports success and rolls
   back nothing.

`sample-migration.js` is the template used by `db:migrate:create`. It is never
executed — migrate-mongo excludes it by name.

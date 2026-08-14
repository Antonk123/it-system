---
name: db-migration
description: >-
  Use when adding or changing ANY database table, column, index, trigger, view,
  or FTS5 setup in this project — i.e. whenever you touch server/src/db/schema.sql
  or need a schema change to take effect. Triggers on: "add a column", "new table",
  "create migration", "alter table", "add an index", "change the schema", "backfill",
  "FTS5", and Swedish "ny tabell", "ny kolumn", "lägg till fält", "migration",
  "ändra schemat", "databasändring". ALWAYS use this instead of writing a standalone
  tsx/SQL script — standalone scripts do NOT run at server startup and the change
  will silently never apply in prod/dev.
---

# Database migrations (IT-Ticket)

The ONLY way a schema change reaches prod/dev is a migration object appended to
the `migrations` array in `server/src/db/migrations.ts`. `runMigrations()` in
`server/src/db/connection.ts` runs them in array order at startup, keyed by `id`
in `schema_migrations`. Standalone `npx tsx` scripts are NOT wired into startup.

## Procedure
1. Read the tail of `server/src/db/migrations.ts` to find the highest `id`
   (sequential zero-padded strings: '001'…'062'). Use the NEXT number, e.g. '063'.
2. Append a new object — never edit a shipped migration's body (forward-only,
   no down()/rollback). To fix prior state, add a CORRECTING migration.
3. Make it idempotent: guard with `tableExists`/`columnExists` helpers and
   `CREATE ... IF NOT EXISTS` / `DROP ... IF EXISTS`. Column-dependent DDL on
   tables created by schema.sql must be guarded for fresh-install ordering.
   **Keep the guard as narrow as the ALTER.** `if (!columnExists(t, c)) { ALTER …;
   CREATE INDEX … }` skips the index on fresh installs — the column is already in
   schema.sql there, so the guard is false and the whole block is skipped. Put
   `CREATE INDEX IF NOT EXISTS` OUTSIDE the guard (nine indexes existed only on
   upgraded DBs before migration 069 fixed exactly this).
4. Multi-statement DDL (triggers with `BEGIN ... END;` internal semicolons) needs
   `db.exec(...)`, not `db.prepare(...).run()`.
5. If this is a NEW table/column that should exist on fresh installs, ALSO add
   it to `server/src/db/schema.sql`. schema.sql runs first for new DBs, migrations
   patch existing DBs — keep them consistent. The build copies schema.sql
   separately (`cp src/db/schema.sql dist/db/schema.sql`), so a schema-only edit
   without a migration breaks existing DBs and vice versa.
   Declare a retrofitted column **last** in its CREATE TABLE: SQLite's ALTER can
   only append, so an inline declaration mid-table gives fresh installs a
   different column order than upgraded ones (harmless until something does
   `INSERT INTO … SELECT *`, which is positional). Never index a retrofitted
   column in schema.sql — that crashes an older DB's boot (see schema.sql's own
   comment about the 2026-07-05 incident); the index belongs in the migration.
6. FTS5 contentless tables (tickets_fts): keep delete triggers as
   `DELETE FROM <fts> WHERE rowid = OLD.rowid` (not VALUES('delete',...)).
   kb_articles_fts is synced manually in routes/kb.ts — do NOT add triggers.
7. Verify: `cd server && npx tsc --noEmit` then `cd server && npm test`
   (migrationXXX.test.ts files spin up a temp DB and assert the end state).
   Consider adding a `migration063.test.ts` mirroring migration061.test.ts.
   Two suite-wide guards run automatically and must stay green:
   `migration-parity.test.ts` (unique ids, restart idempotency, nothing skipped)
   and `schema-path-parity.test.ts` (a fresh install must end up with the same
   schema as an upgraded one — it replays a frozen snapshot of a long-running
   instance through your new migration). If the latter fails, your migration
   treats the two install paths differently; fix that rather than widening the
   accepted-divergence lists.

## Anti-patterns
- Writing a one-off SQL/tsx script to ALTER the DB → never runs at startup
  (`add-performance-indexes.ts` did exactly this: run by hand against prod, then
  deleted — two indexes lived only in prod until migration 069 restored them).
- Editing an already-shipped migration to "fix" it → breaks deterministic replay.
- Adding a column to schema.sql but not as a migration → existing DBs miss it.
- `CREATE INDEX` inside a `columnExists` guard → the index never reaches fresh installs.
- Dropping/rebuilding a table other tables reference with `ON DELETE CASCADE`:
  `PRAGMA foreign_keys = OFF` is a no-op inside the runner's transaction, so the
  DROP cascade-deletes the children (why `ticket_templates` is left alone while
  `kb_article_tags`, which nothing references, could be rebuilt in migration 070).

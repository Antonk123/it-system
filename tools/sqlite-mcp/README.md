# itticket-sqlite-mcp

Read-only MCP server for inspecting the IT-Ticket SQLite database from Claude Code —
schema, migration state, FTS5 internals — without writing throwaway `tsx` scripts.

Read-only is **engine-enforced**, not advisory:

- `better-sqlite3` opened `{ readonly: true, fileMustExist: true }` (`SQLITE_OPEN_READONLY`)
- `PRAGMA query_only = ON`
- only read tools are registered — there is no write/DDL surface at all

This is intentionally a tiny owned server: no maintained npm SQLite MCP package
enforces read-only (they all expose `write_query` / `create_table`).

## Tools

| Tool | Input | Returns |
|------|-------|---------|
| `list_tables` | — | tables + views |
| `describe_table` | `table` | `PRAGMA table_info` columns |
| `read_query` | `sql` | rows of one SELECT/WITH/PRAGMA/EXPLAIN (≤1000) |

## Install

```bash
cd tools/sqlite-mcp
npm install
```

## Register with Claude Code (user scope, local machine)

Point it at the **local** dev DB file (safe — writes are impossible):

```bash
claude mcp add sqlite-itticket-ro -- \
  node /Users/anton/Downloads/Projekt/Github/it-system/tools/sqlite-mcp/server.mjs \
       /Users/anton/Downloads/Projekt/Github/it-system/server/data/database.sqlite
```

Verify: `claude mcp list`. Never point it at a prod/dev volume on the server.

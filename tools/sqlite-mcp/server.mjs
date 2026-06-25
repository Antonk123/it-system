#!/usr/bin/env node
// Read-only MCP server for the IT-Ticket SQLite database.
//
// Why this exists: we want Claude to inspect the dev DB (schema, migrations,
// FTS5 state) WITHOUT writing one-off tsx scripts — but no maintained npm SQLite
// MCP server enforces read-only (they all expose write_query/create_table). This
// ~50-line server is fully owned (no third-party MCP package to trust) and makes
// read-only a hard, engine-level guarantee:
//   • better-sqlite3 opened with { readonly: true }  → SQLITE_OPEN_READONLY
//   • PRAGMA query_only = ON                          → belt-and-suspenders
//   • only read tools are registered                  → no write surface at all
//
// Usage (Claude Code registers it like this):
//   node server.mjs <absolute-path-to-sqlite-db>
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import Database from 'better-sqlite3';

const dbPath = process.argv[2];
if (!dbPath) {
  process.stderr.write('Usage: node server.mjs <path-to-sqlite-db>\n');
  process.exit(1);
}

// readonly + fileMustExist: this process physically cannot mutate the DB.
const db = new Database(dbPath, { readonly: true, fileMustExist: true });
db.pragma('query_only = ON');

const MAX_ROWS = 1000;
const READ_PREFIX = /^\s*(select|with|pragma|explain)\b/i;

const ok = (data) => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });
const fail = (msg) => ({ content: [{ type: 'text', text: `ERROR: ${msg}` }], isError: true });

const server = new McpServer({ name: 'itticket-sqlite-ro', version: '1.0.0' });

server.registerTool(
  'list_tables',
  { description: 'List all tables and views in the IT-Ticket SQLite database.', inputSchema: {} },
  async () => ok(
    db.prepare(
      "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
    ).all()
  )
);

server.registerTool(
  'describe_table',
  { description: 'Show the column schema (PRAGMA table_info) of one table or view.', inputSchema: { table: z.string() } },
  async ({ table }) => {
    const exists = db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name = ?").get(table);
    if (!exists) return fail(`No such table/view: ${table}`);
    // PRAGMA can't bind an identifier — safe to interpolate only after the name
    // is confirmed to exist; escape embedded double-quotes defensively.
    return ok(db.prepare(`PRAGMA table_info("${table.replace(/"/g, '""')}")`).all());
  }
);

server.registerTool(
  'read_query',
  {
    description: 'Run ONE read-only SQL query (SELECT / WITH / PRAGMA / EXPLAIN). Writes are rejected at the engine level. Returns at most 1000 rows.',
    inputSchema: { sql: z.string() },
  },
  async ({ sql }) => {
    if (!READ_PREFIX.test(sql)) return fail('Only SELECT / WITH / PRAGMA / EXPLAIN queries are allowed.');
    try {
      const stmt = db.prepare(sql); // better-sqlite3 rejects multi-statement input
      const rows = stmt.reader ? stmt.all() : [];
      return ok({ rowCount: rows.length, truncated: rows.length > MAX_ROWS, rows: rows.slice(0, MAX_ROWS) });
    } catch (e) {
      return fail(e.message);
    }
  }
);

await server.connect(new StdioServerTransport());
process.stderr.write(`itticket-sqlite-ro MCP server connected (readonly) → ${dbPath}\n`);

/**
 * Skannar migrations.ts-källtext och mappar tabellnamn -> lista av migrations-id.
 * Migrationer ser ut som { id: '063', name: '...', up: (db) => { db.exec('CREATE TABLE ...') } }.
 */
export function parseMigrationTables(source: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const ident = '([a-zA-Z_][a-zA-Z0-9_]*)';
  const matches = [...source.matchAll(/id:\s*['"]([^'"]+)['"]/g)];
  for (let i = 0; i < matches.length; i++) {
    const id = matches[i][1];
    const start = matches[i].index ?? 0;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? source.length) : source.length;
    const block = source.slice(start, end);
    const tables = new Set<string>();
    for (const m of block.matchAll(new RegExp(`CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${ident}`, 'gi')))
      tables.add(m[1].toLowerCase());
    for (const m of block.matchAll(new RegExp(`ALTER\\s+TABLE\\s+${ident}`, 'gi'))) tables.add(m[1].toLowerCase());
    for (const t of tables) (result[t] ??= []).push(id);
  }
  return result;
}

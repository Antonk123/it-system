import { SourceFile, SyntaxKind } from 'ts-morph';

export interface RouteRegistration {
  prefix: string; // t.ex. /api/companies
  routerIdent: string; // t.ex. companiesRoutes
}

/** Hittar alla app.use('/api/...', xxxRoutes)-anrop i app.ts. */
export function parseRouteRegistrations(sf: SourceFile): RouteRegistration[] {
  const out: RouteRegistration[] = [];
  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const expr = call.getExpression().getText();
    if (expr !== 'app.use') continue;
    const args = call.getArguments();
    if (args.length < 2) continue;
    const first = args[0];
    if (!first.isKind(SyntaxKind.StringLiteral)) continue;
    const prefix = first.getLiteralText();
    if (!prefix.startsWith('/api/')) continue;
    out.push({ prefix, routerIdent: args[1].getText() });
  }
  return out;
}

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

export interface RouteFileResult {
  endpoints: { method: string; path: string }[];
  serviceImports: string[]; // moduler importerade från ../lib/*
  reads: string[]; // tabeller i SELECT
  writes: string[]; // tabeller i INSERT/UPDATE/DELETE
}

/** Drar ut SQL-tabellnamn ur en sträng. Hanterar SELECT...FROM/JOIN och INSERT/UPDATE/DELETE. */
export function extractTables(sql: string): { reads: string[]; writes: string[] } {
  const reads = new Set<string>();
  const writes = new Set<string>();
  const ident = '([a-zA-Z_][a-zA-Z0-9_]*)';
  for (const m of sql.matchAll(new RegExp(`\\bFROM\\s+${ident}`, 'gi'))) reads.add(m[1].toLowerCase());
  for (const m of sql.matchAll(new RegExp(`\\bJOIN\\s+${ident}`, 'gi'))) reads.add(m[1].toLowerCase());
  for (const m of sql.matchAll(new RegExp(`\\bINTO\\s+${ident}`, 'gi'))) writes.add(m[1].toLowerCase());
  for (const m of sql.matchAll(new RegExp(`\\bUPDATE\\s+${ident}`, 'gi'))) writes.add(m[1].toLowerCase());
  for (const m of sql.matchAll(new RegExp(`\\bDELETE\\s+FROM\\s+${ident}`, 'gi'))) writes.add(m[1].toLowerCase());
  // 'DELETE FROM x' matchas även av FROM-regeln ovan; flytta sådana till writes
  for (const w of writes) if (new RegExp(`DELETE\\s+FROM\\s+${w}`, 'i').test(sql)) reads.delete(w);
  return { reads: [...reads], writes: [...writes] };
}

const SQL_RE = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;

function collectSqlFrom(sf: SourceFile, reads: Set<string>, writes: Set<string>) {
  const collect = (text: string) => {
    if (!SQL_RE.test(text)) return;
    const t = extractTables(text);
    t.reads.forEach((r) => reads.add(r));
    t.writes.forEach((w) => writes.add(w));
  };
  for (const lit of sf.getDescendantsOfKind(SyntaxKind.StringLiteral)) collect(lit.getLiteralText());
  for (const lit of sf.getDescendantsOfKind(SyntaxKind.NoSubstitutionTemplateLiteral)) collect(lit.getLiteralText());
  for (const lit of sf.getDescendantsOfKind(SyntaxKind.TemplateExpression)) collect(lit.getText());
}

export function parseRouteFile(sf: SourceFile, prefix: string): RouteFileResult {
  const endpoints: { method: string; path: string }[] = [];
  const serviceImports: string[] = [];
  const reads = new Set<string>();
  const writes = new Set<string>();

  for (const imp of sf.getImportDeclarations()) {
    const spec = imp.getModuleSpecifierValue();
    if (spec.includes('/lib/')) serviceImports.push(spec);
  }

  for (const call of sf.getDescendantsOfKind(SyntaxKind.CallExpression)) {
    const dot = call.getExpression().getText().split('.'); // t.ex. router.get
    if (dot.length === 2 && dot[0] === 'router' && (HTTP_METHODS as readonly string[]).includes(dot[1])) {
      const first = call.getArguments()[0];
      if (first?.isKind(SyntaxKind.StringLiteral)) {
        endpoints.push({ method: dot[1].toUpperCase(), path: first.getLiteralText() });
      }
    }
  }

  collectSqlFrom(sf, reads, writes);
  void prefix; // används av anroparen för nod-id, behålls i signaturen för tydlighet
  return { endpoints, serviceImports, reads: [...reads], writes: [...writes] };
}

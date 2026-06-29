import { Project, SourceFile } from 'ts-morph';
import fs from 'node:fs';
import path from 'node:path';
import { resolveRepoRoot, GLOBS } from '../config.js';
import type { Graph, GraphNode, GraphEdge } from '../types.js';
import { parseRouteRegistrations, parseRouteFile } from './routes.js';
import { parseApiClient } from './apiClient.js';
import { parseHookApiCalls, parsePageHookImports } from './frontend.js';
import { parseServiceFile } from './services.js';
import { parseMigrationTables } from './database.js';
import { classifyDomain } from '../domain.js';

/** Enkel rekursiv glob utan beroenden: stöder ** och *.ext. Returnerar sökvägar relativt root. */
export function globSyncRel(root: string, pattern: string): string[] {
  const out: string[] = [];
  const parts = pattern.split('/');
  const safeReaddir = (p: string) => (fs.existsSync(p) ? fs.readdirSync(p) : []);
  const walk = (dir: string, idx: number) => {
    if (idx >= parts.length) return;
    const seg = parts[idx];
    const abs = path.join(root, dir);
    if (seg === '**') {
      walk(dir, idx + 1);
      for (const e of safeReaddir(abs))
        if (fs.statSync(path.join(abs, e)).isDirectory()) walk(path.join(dir, e), idx);
    } else if (idx === parts.length - 1) {
      const re = new RegExp('^' + seg.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
      for (const e of safeReaddir(abs))
        if (re.test(e) && fs.statSync(path.join(abs, e)).isFile()) out.push(path.join(dir, e));
    } else {
      const sub = path.join(dir, seg);
      if (fs.existsSync(path.join(root, sub))) walk(sub, idx + 1);
    }
  };
  walk('', 0);
  return out;
}

export function buildAutoGraph(root: string = resolveRepoRoot()): Graph {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  const nodeMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const addNode = (n: GraphNode) => {
    if (!nodeMap.has(n.id)) nodeMap.set(n.id, { ...n, source: 'auto' });
  };
  const addEdge = (e: GraphEdge) => edges.push(e);
  const sf = (rel: string): SourceFile => project.addSourceFileAtPath(path.join(root, rel));
  const serviceLayer = (name: string): GraphNode['layer'] =>
    /Scheduler$/.test(name) ? 'scheduler' : name === 'aiHelper' ? 'ai' : 'service';
  // Migrationer parsas i förväg så tabell-noder kan visa vilka migrationer som rör dem
  // (i stället för separata migrations-noder som skräpar ner DB-kolumnen).
  const tableToMig = parseMigrationTables(fs.readFileSync(path.join(root, GLOBS.migrations), 'utf8'));
  const tableNode = (t: string): GraphNode => ({
    id: `table:${t}`,
    label: t,
    layer: 'db-table',
    file: GLOBS.migrations,
    loc: tableToMig[t] ? `migrationer: ${tableToMig[t].join(', ')}` : GLOBS.migrations,
    source: 'auto',
  });

  // 1. API-registrering: prefix -> router-ident, samt ident -> route-fil (via app.ts-imports)
  const appSf = sf(GLOBS.appRegistration);
  const regs = parseRouteRegistrations(appSf);
  const identToPrefix = new Map(regs.map((r) => [r.routerIdent, r.prefix] as const));
  const identToFile = new Map<string, string>();
  for (const imp of appSf.getImportDeclarations()) {
    const def = imp.getDefaultImport();
    const spec = imp.getModuleSpecifierValue();
    if (def && spec.includes('/routes/')) identToFile.set(def.getText(), spec.split('/').pop()!.replace('.js', '.ts'));
  }

  // 2. Route-filer: noder + service-imports + tabeller
  for (const [ident, prefix] of identToPrefix) {
    const routeFileName = identToFile.get(ident) ?? `${prefix.replace('/api/', '')}.ts`;
    const rel = `server/src/routes/${routeFileName}`;
    if (!fs.existsSync(path.join(root, rel))) continue;
    const routeId = `route:${prefix}`;
    addNode({ id: routeId, label: prefix, layer: 'api-route', file: rel, loc: rel, source: 'auto' });
    const r = parseRouteFile(sf(rel), prefix);
    for (const spec of r.serviceImports) {
      const svc = spec.split('/').pop()!.replace('.js', '');
      addNode({
        id: `service:${svc}`,
        label: svc,
        layer: serviceLayer(svc),
        file: `server/src/lib/${svc}.ts`,
        loc: `server/src/lib/${svc}.ts`,
        source: 'auto',
      });
      addEdge({ source: routeId, target: `service:${svc}`, kind: 'uses' });
    }
    for (const t of r.reads) {
      addNode(tableNode(t));
      addEdge({ source: routeId, target: `table:${t}`, kind: 'reads' });
    }
    for (const t of r.writes) {
      addNode(tableNode(t));
      addEdge({ source: routeId, target: `table:${t}`, kind: 'writes' });
    }
  }

  // 3. API-klient: metod -> route-prefix
  for (const m of parseApiClient(sf(GLOBS.apiClient))) {
    const apiId = `api:${m.name}`;
    addNode({
      id: apiId,
      label: `api.${m.name}`,
      layer: 'api-client',
      file: 'src/lib/api.ts',
      loc: `src/lib/api.ts:${m.line}`,
      source: 'auto',
    });
    if (nodeMap.has(`route:${m.prefix}`)) addEdge({ source: apiId, target: `route:${m.prefix}`, kind: 'calls' });
  }

  // 4. Hooks: noder + hook -> api-method
  for (const rel of globSyncRel(root, GLOBS.hooks)) {
    const hookName = path.basename(rel, '.ts');
    if (!hookName.startsWith('use') || hookName.endsWith('.test')) continue;
    const hookId = `hook:${hookName}`;
    addNode({ id: hookId, label: hookName, layer: 'frontend-hook', file: rel, loc: rel, source: 'auto' });
    for (const c of parseHookApiCalls(sf(rel)))
      if (nodeMap.has(`api:${c}`)) addEdge({ source: hookId, target: `api:${c}`, kind: 'calls' });
  }

  // 5. Frontend-moduler (sidor, components, contexts): noder + modul -> hook + modul -> api.
  //    Components/contexts tas bara med om de faktiskt rör en hook eller api.* (annars ren UI).
  const addFrontendModule = (rel: string, id: string, label: string, always: boolean) => {
    const src = sf(rel);
    const hooks = parsePageHookImports(src).filter((h) => nodeMap.has(`hook:${h}`));
    const apis = parseHookApiCalls(src).filter((a) => nodeMap.has(`api:${a}`));
    if (!always && hooks.length === 0 && apis.length === 0) return;
    addNode({ id, label, layer: 'frontend-page', file: rel, loc: rel, source: 'auto' });
    for (const h of hooks) addEdge({ source: id, target: `hook:${h}`, kind: 'calls' });
    for (const a of apis) addEdge({ source: id, target: `api:${a}`, kind: 'calls' });
  };
  for (const rel of globSyncRel(root, GLOBS.pages))
    addFrontendModule(rel, `page:${path.basename(rel, '.tsx')}`, path.basename(rel, '.tsx'), true);
  for (const rel of globSyncRel(root, GLOBS.contexts))
    addFrontendModule(rel, `ctx:${path.basename(rel, '.tsx')}`, path.basename(rel, '.tsx'), false);
  for (const rel of globSyncRel(root, GLOBS.components))
    addFrontendModule(rel, `comp:${path.basename(rel, '.tsx')}`, path.basename(rel, '.tsx'), false);

  // 6. Services/schedulers: noder + service -> table + service -> service
  for (const rel of globSyncRel(root, GLOBS.services)) {
    const name = path.basename(rel, '.ts');
    if (name.endsWith('.test')) continue;
    const r = parseServiceFile(sf(rel));
    const layer = serviceLayer(name);
    const id = `service:${name}`;
    addNode({ id, label: name, layer, file: rel, loc: rel, source: 'auto' });
    for (const t of r.reads) {
      addNode(tableNode(t));
      addEdge({ source: id, target: `table:${t}`, kind: 'reads' });
    }
    for (const t of r.writes) {
      addNode(tableNode(t));
      addEdge({ source: id, target: `table:${t}`, kind: 'writes' });
    }
    for (const spec of r.libImports) {
      const dep = spec.split('/').pop()!.replace('.js', '');
      if (dep && dep !== name) {
        addNode({
          id: `service:${dep}`,
          label: dep,
          layer: serviceLayer(dep),
          file: `server/src/lib/${dep}.ts`,
          loc: `server/src/lib/${dep}.ts`,
          source: 'auto',
        });
        addEdge({ source: id, target: `service:${dep}`, kind: 'uses' });
      }
    }
  }

  // 7. Säkerställ att alla tabeller från migrationerna finns som noder
  //    (migrations-info ligger på tabell-nodens loc, inga separata migrations-noder).
  for (const table of Object.keys(tableToMig)) addNode(tableNode(table));

  // Stämpla domän på varje nod (för gruppering i kartan).
  const nodes = [...nodeMap.values()].map((n) => ({ ...n, domain: classifyDomain(n.label, n.id) }));
  return { nodes, edges: dedupeEdges(edges) };
}

function dedupeEdges(edges: GraphEdge[]): GraphEdge[] {
  const seen = new Set<string>();
  return edges.filter((e) => {
    const k = `${e.source}|${e.target}|${e.kind}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// CLI: skriv graph.auto.json
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = resolveRepoRoot(process.argv[2]);
  const graph = buildAutoGraph(root);
  const outPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', '..', 'graph.auto.json');
  fs.writeFileSync(outPath, JSON.stringify(graph, null, 2));
  console.log(`Wrote ${graph.nodes.length} nodes, ${graph.edges.length} edges -> ${outPath}`);
}

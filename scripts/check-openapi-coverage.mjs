#!/usr/bin/env node
/**
 * CI-gate: varje monterad Express-route måste finnas i docs/openapi.yaml.
 *
 * Läser mount-punkter ur server/src/app.ts (`app.use('/api/x', xRoutes)` samt
 * direkta `app.get('/api/...')`), nästlade `router.use('/p', subRouter)` i
 * routes/*.ts och alla `router.<verb>('<path>'`-anrop. `:param` normaliseras
 * till `{param}` och parameternamn ignoreras vid jämförelse (specen får döpa
 * sina path-parametrar fritt). Specen läses utan YAML-beroende: path-nycklar
 * på 2 blanksteg och metoder på 4 blanksteg under `paths:`.
 *
 * Användning:  node scripts/check-openapi-coverage.mjs
 * Exit 1 om en (metod, path) saknas i specen. Omvänd drift (spec-operation utan
 * route) rapporteras också som fel.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const routesDir = join(root, 'server/src/routes');
const VERBS = ['get', 'post', 'put', 'patch', 'delete'];

// Interna routes som medvetet inte dokumenteras i den publika specen.
// Nyckel: "METOD /api/path" (normaliserad med {param}). Värde: motivering.
const IGNORE = new Map([
  // (tom — alla monterade routes är dokumenterade)
]);

const norm = (p) =>
  p
    .replace(/:([A-Za-z0-9_]+)/g, '{$1}')
    .replace(/\/+/g, '/')
    .replace(/(.)\/$/, '$1');
// Jämförelsenyckel: parameternamn spelar ingen roll.
const key = (method, path) => `${method.toUpperCase()} ${norm(path).replace(/\{[^}]+\}/g, '{}')}`;

// --- Importkarta: variabelnamn -> routefil ----------------------------------
function importMap(src) {
  const map = new Map();
  for (const m of src.matchAll(/import\s+(?:\{[^}]*\}\s*,\s*)?(\w+)(?:\s*,\s*\{[^}]*\})?\s+from\s+'(\.\/(?:routes\/)?[\w-]+)\.js'/g)) {
    map.set(m[1], m[2].replace(/^\.\/(routes\/)?/, ''));
  }
  return map;
}

// --- Routes per fil (relativt filens egen router) ---------------------------
function fileRoutes(name) {
  const src = readFileSync(join(routesDir, `${name}.ts`), 'utf8');
  const out = [];
  const re = new RegExp(`\\b\\w*[rR]outer\\.(${VERBS.join('|')})\\(\\s*['"\`]([^'"\`]+)['"\`]`, 'g');
  for (const m of src.matchAll(re)) out.push({ method: m[1], path: m[2] });
  // Nästlade routrar: router.use('/prefix', subRouter)
  const imports = importMap(src);
  for (const m of src.matchAll(/\brouter\.use\(\s*['"`]([^'"`]+)['"`]\s*,\s*(\w+)\s*\)/g)) {
    const sub = imports.get(m[2]);
    if (!sub) continue;
    for (const r of fileRoutes(sub)) out.push({ method: r.method, path: m[1] + (r.path === '/' ? '' : r.path) });
  }
  return out;
}

// --- Monterade routes ---------------------------------------------------------
const appSrc = readFileSync(join(root, 'server/src/app.ts'), 'utf8');
const appImports = importMap(appSrc);
const mounted = [];
for (const m of appSrc.matchAll(/app\.use\(\s*['"`](\/api\/[\w/-]+)['"`]\s*,\s*(\w+)\s*\)/g)) {
  const file = appImports.get(m[2]);
  if (!file) {
    console.error(`Kunde inte lösa router "${m[2]}" från app.ts`);
    process.exit(2);
  }
  for (const r of fileRoutes(file)) {
    mounted.push({ method: r.method, path: m[1] + (r.path === '/' ? '' : r.path), file });
  }
}
for (const m of appSrc.matchAll(/app\.(get|post|put|patch|delete)\(\s*['"`](\/api\/[^'"`]+)['"`]/g)) {
  mounted.push({ method: m[1], path: m[2], file: 'app.ts' });
}

// Varje routes/*.ts som inte monteras ska inte finnas (dött kodspår).
const used = new Set([...appImports.values()]);
const unmounted = readdirSync(routesDir)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => f.replace(/\.ts$/, ''))
  .filter((f) => !used.has(f) && !/^template-fields$/.test(f));

// --- Spec ----------------------------------------------------------------------
const specLines = readFileSync(join(root, 'docs/openapi.yaml'), 'utf8').split('\n');
const spec = new Set();
let inPaths = false;
let current = null;
for (const line of specLines) {
  if (/^paths:\s*$/.test(line)) { inPaths = true; continue; }
  if (inPaths && /^\S/.test(line) && !line.startsWith('#')) break; // nästa toppnivånyckel
  if (!inPaths) continue;
  let m;
  if ((m = line.match(/^  (\/\S*):\s*$/))) { current = m[1]; continue; }
  if (current && (m = line.match(/^    (get|post|put|patch|delete):\s*$/))) {
    spec.add(key(m[1], '/api' + current));
  }
}

const mountedKeys = new Map();
for (const r of mounted) mountedKeys.set(key(r.method, r.path), `${r.method.toUpperCase()} ${norm(r.path)}`);

const missing = [];
for (const [k, label] of mountedKeys) {
  if (!spec.has(k) && !IGNORE.has(label)) missing.push(label);
}
const extra = [...spec].filter((k) => !mountedKeys.has(k));
const staleIgnore = [...IGNORE.keys()].filter((l) => !mountedKeys.has(key(...l.split(' '))));

console.log(`Monterade operationer: ${mountedKeys.size}  |  operationer i spec: ${spec.size}  |  ignorerade: ${IGNORE.size}`);
let failed = false;
if (missing.length) {
  failed = true;
  console.error(`\nSaknas i docs/openapi.yaml (${missing.length}):`);
  for (const l of missing.sort()) console.error(`  - ${l}`);
}
if (extra.length) {
  failed = true;
  console.error(`\nI specen men utan monterad route (${extra.length}):`);
  for (const l of extra.sort()) console.error(`  - ${l}`);
}
if (staleIgnore.length) {
  failed = true;
  console.error(`\nIGNORE-poster utan motsvarande route: ${staleIgnore.join(', ')}`);
}
if (unmounted.length) {
  failed = true;
  console.error(`\nRoutefiler som inte monteras i app.ts: ${unmounted.join(', ')}`);
}
if (failed) process.exit(1);
console.log('OpenAPI-täckning OK.');

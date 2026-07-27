#!/usr/bin/env node
/**
 * CI-gate för `npm audit` med en smal, motiverad undantagslista.
 *
 * Varför inte bara `npm audit --audit-level=high`: när en enda advisory är
 * obestridligt icke-nåbar i den här appen är alternativen annars att antingen
 * lämna CI röd eller sänka hela gaten till `critical` — och då tystnar även
 * FRAMTIDA high-advisories, vilket är precis det gaten finns för att fånga.
 * Det här skriptet fäller bygget på allt high/critical UTOM de advisories som
 * är uttryckligen listade i audit-allowlist.json, med motivering och utgångsdatum.
 *
 * Användning:  node scripts/audit-check.mjs [katalog]   (default: .)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BLOCKING = new Set(['high', 'critical']);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const targetDir = resolve(process.argv[2] ?? '.');
const label = targetDir === repoRoot ? 'root' : targetDir.slice(repoRoot.length + 1) || 'root';

// --- Undantagslistan -------------------------------------------------------
const allowlist = JSON.parse(readFileSync(join(repoRoot, 'audit-allowlist.json'), 'utf8'));
const today = new Date().toISOString().slice(0, 10);

const expired = allowlist.allow.filter((e) => e.expires && e.expires < today);
const active = new Map(
  allowlist.allow.filter((e) => !e.expires || e.expires >= today).map((e) => [e.id, e]),
);

// --- Kör npm audit ---------------------------------------------------------
let raw;
try {
  // execFileSync (inte execSync): inget skal inblandat, inga metatecken tolkas.
  raw = execFileSync('npm', ['audit', '--json'], {
    cwd: targetDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  // npm audit avslutar med kod 1 när sårbarheter hittas — utdatan är ändå giltig.
  raw = err.stdout;
}
if (!raw) {
  console.error(`[audit-check:${label}] Fick ingen utdata från npm audit.`);
  process.exit(1);
}

const report = JSON.parse(raw);
const vulns = report.vulnerabilities ?? {};

/** Samla advisory-id:n (GHSA-…) som en post pekar direkt på. */
const advisoryIds = (v) =>
  (v.via ?? [])
    .filter((x) => typeof x === 'object' && x.url)
    .map((x) => x.url.split('/').pop())
    .filter(Boolean);

/** Paket som denna post ärver sin sårbarhet från (via-strängar). */
const parents = (v) => (v.via ?? []).filter((x) => typeof x === 'string');

// Ett paket är "rensat" om varje advisory det pekar på är undantagen OCH varje
// paket det ärver från också är rensat. Iterera till fixpunkt eftersom
// transitiva poster bara refererar sitt förälderpaket, inte advisoryn.
const cleared = new Set();
for (let changed = true; changed; ) {
  changed = false;
  for (const [name, v] of Object.entries(vulns)) {
    if (cleared.has(name) || !BLOCKING.has(v.severity)) continue;
    const ids = advisoryIds(v);
    const ps = parents(v);
    if (ids.length === 0 && ps.length === 0) continue;
    const idsOk = ids.every((id) => active.has(id));
    const parentsOk = ps.every((p) => cleared.has(p) || !BLOCKING.has(vulns[p]?.severity ?? 'low'));
    if (idsOk && parentsOk) {
      cleared.add(name);
      changed = true;
    }
  }
}

const blocking = Object.entries(vulns)
  .filter(([name, v]) => BLOCKING.has(v.severity) && !cleared.has(name))
  .map(([name, v]) => ({ name, severity: v.severity, ids: advisoryIds(v), via: parents(v) }));

// --- Rapport ---------------------------------------------------------------
const counts = report.metadata?.vulnerabilities ?? {};
console.log(
  `[audit-check:${label}] high=${counts.high ?? 0} critical=${counts.critical ?? 0} ` +
    `| undantagna=${cleared.size} | blockerande=${blocking.length}`,
);

for (const name of cleared) {
  const id = advisoryIds(vulns[name])[0];
  const entry = id ? active.get(id) : null;
  console.log(`  ↷ undantagen: ${name}${entry ? ` (${entry.id}, omprövas ${entry.expires})` : ' (ärvd)'}`);
}

if (expired.length) {
  console.error(`\n[audit-check:${label}] UNDANTAG HAR GÅTT UT — måste omprövas:`);
  for (const e of expired) console.error(`  ✗ ${e.id} (${e.package}) gick ut ${e.expires}`);
  process.exit(1);
}

if (blocking.length) {
  console.error(`\n[audit-check:${label}] BLOCKERANDE advisories:`);
  for (const b of blocking) {
    console.error(`  ✗ ${b.severity.toUpperCase()} ${b.name} ${b.ids.join(', ') || `(via ${b.via.join(', ')})`}`);
  }
  console.error(
    '\nÅtgärda dem, eller lägg till en post i audit-allowlist.json med motivering\n' +
      'för varför den inte är nåbar i den här appen, plus ett expires-datum.',
  );
  process.exit(1);
}

console.log(`[audit-check:${label}] OK`);

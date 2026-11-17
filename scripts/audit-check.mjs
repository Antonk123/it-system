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
let auditExitCode = 0;
try {
  // execFileSync (inte execSync): inget skal inblandat, inga metatecken tolkas.
  raw = execFileSync('npm', ['audit', '--json'], {
    cwd: targetDir,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
} catch (err) {
  // npm audit använder kod 1 för sårbarheter. Andra processfel får inte bli
  // en grön säkerhetskontroll, även om stdout råkar se ut som en rapport.
  if (err.status !== 1 || err.signal) {
    console.error(`[audit-check:${label}] npm audit kunde inte slutföras.`);
    process.exit(1);
  }
  auditExitCode = err.status;
  raw = err.stdout;
}
if (!raw) {
  console.error(`[audit-check:${label}] Fick ingen utdata från npm audit.`);
  process.exit(1);
}

function invalidReport(reason) {
  console.error(`[audit-check:${label}] Ogiltigt resultat från npm audit: ${reason}`);
  process.exit(1);
}

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const severities = ['info', 'low', 'moderate', 'high', 'critical'];
let report;
try {
  report = JSON.parse(raw);
} catch {
  invalidReport('svaret är inte JSON.');
}

// Ett registryfel kan ge giltig JSON med enbart `error`. Kräv en komplett
// rapport och kontrollera dess räkning innan den används som säkerhetsbevis.
if (!isRecord(report) || Object.hasOwn(report, 'error') || report.auditReportVersion !== 2 ||
    !isRecord(report.vulnerabilities) || !isRecord(report.metadata?.vulnerabilities)) {
  invalidReport('förväntade en npm audit v2-rapport utan error.');
}
const vulns = report.vulnerabilities;
const counts = report.metadata.vulnerabilities;
const observedCounts = Object.fromEntries(severities.map((severity) => [severity, 0]));
for (const [name, vulnerability] of Object.entries(vulns)) {
  if (!isRecord(vulnerability) || vulnerability.name !== name ||
      !severities.includes(vulnerability.severity) || !Array.isArray(vulnerability.via) ||
      vulnerability.via.length === 0) {
    invalidReport('en sårbarhet saknar giltigt namn, allvarlighetsgrad eller advisorykedja.');
  }
  for (const source of vulnerability.via) {
    if (typeof source === 'string') {
      if (!Object.hasOwn(vulns, source) || !isRecord(vulns[source]) || !severities.includes(vulns[source].severity)) {
        invalidReport('en advisorykedja hänvisar till ett paket som saknas eller är ogiltigt.');
      }
    } else if (!isRecord(source) || typeof source.name !== 'string' || !source.name ||
        !severities.includes(source.severity) || typeof source.url !== 'string' || !source.url) {
      invalidReport('en advisory saknar giltig källa.');
    }
    const sourceSeverity = typeof source === 'string' ? vulns[source].severity : source.severity;
    if (severities.indexOf(sourceSeverity) > severities.indexOf(vulnerability.severity)) {
      invalidReport('ett paket har lägre allvarlighetsgrad än sin advisorykedja.');
    }
  }
  observedCounts[vulnerability.severity]++;
}
if ([...severities, 'total'].some((severity) => !Number.isSafeInteger(counts[severity]) || counts[severity] < 0) ||
    severities.some((severity) => counts[severity] !== observedCounts[severity]) ||
    counts.total !== Object.keys(vulns).length || (auditExitCode === 1 && counts.total === 0)) {
  invalidReport('sammanräkningen stämmer inte med rapportens sårbarheter eller exitkod.');
}

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
console.log(
  `[audit-check:${label}] high=${counts.high} critical=${counts.critical} ` +
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

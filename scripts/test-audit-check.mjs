import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'audit-check.mjs');
const severityNames = ['info', 'low', 'moderate', 'high', 'critical'];

function report(vulnerabilities = {}) {
  const counts = Object.fromEntries(severityNames.map((name) => [name, 0]));
  for (const vulnerability of Object.values(vulnerabilities)) counts[vulnerability.severity]++;
  return {
    auditReportVersion: 2,
    vulnerabilities,
    metadata: { vulnerabilities: { ...counts, total: Object.keys(vulnerabilities).length } },
  };
}

function vulnerability(severity = 'high') {
  return {
    name: 'fixture-package', severity,
    via: [{ name: 'fixture-package', severity, url: 'https://github.com/advisories/GHSA-fixture' }],
  };
}

// Run the real CLI in its own repository-shaped fixture. Only npm is replaced;
// assertions observe the gate's exit status and output, including allowlists.
function runGate(t, { body = report(), exit = 0, signal, allow = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'it-audit-gate-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'scripts'));
  mkdirSync(join(root, 'bin'));
  copyFileSync(script, join(root, 'scripts/audit-check.mjs'));
  writeFileSync(join(root, 'audit-allowlist.json'), JSON.stringify({ allow }));
  writeFileSync(join(root, 'bin/npm'), `#!/usr/bin/env node
process.stdout.write(process.env.AUDIT_FIXTURE_BODY);
if (process.env.AUDIT_FIXTURE_SIGNAL) process.kill(process.pid, process.env.AUDIT_FIXTURE_SIGNAL);
else process.exit(Number(process.env.AUDIT_FIXTURE_EXIT));
`, { mode: 0o755 });
  return spawnSync(process.execPath, [join(root, 'scripts/audit-check.mjs'), '.'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      PATH: join(root, 'bin') + ':' + process.env.PATH,
      AUDIT_FIXTURE_BODY: typeof body === 'string' ? body : JSON.stringify(body),
      AUDIT_FIXTURE_EXIT: String(exit),
      AUDIT_FIXTURE_SIGNAL: signal ?? '',
    },
  });
}

test('a completed clean audit passes', (t) => {
  const result = runGate(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /high=0 critical=0/);
  assert.match(result.stdout, /OK/);
});

test('valid high findings block regardless of npm audit exit threshold', (t) => {
  for (const exit of [0, 1]) {
    const result = runGate(t, { body: report({ 'fixture-package': vulnerability() }), exit });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /BLOCKERANDE advisories/);
    assert.doesNotMatch(result.stdout, /OK/);
  }
});

test('moderate findings do not change the high/critical policy', (t) => {
  const result = runGate(t, { body: report({ 'fixture-package': vulnerability('moderate') }), exit: 1 });
  assert.equal(result.status, 0, result.stderr);
});

test('a narrow active exception clears its advisory and inherited package', (t) => {
  const body = report({
    'fixture-package': vulnerability(),
    parent: { name: 'parent', severity: 'high', via: ['fixture-package'] },
  });
  const result = runGate(t, {
    body, exit: 1,
    allow: [{ id: 'GHSA-fixture', package: 'fixture-package', reason: 'Fixture only', expires: '2999-01-01' }],
  });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /undantagna=2/);
});

test('expired exceptions still fail even when the audit is clean', (t) => {
  const result = runGate(t, {
    allow: [{ id: 'GHSA-fixture', package: 'fixture-package', reason: 'Fixture only', expires: '2000-01-01' }],
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /UNDANTAG HAR GÅTT UT/);
});

const malformedReports = [
  ['registry JSON error', { error: { code: 'ENOAUDIT', summary: 'Registry unavailable' } }],
  ['error alongside a clean-looking report', { ...report(), error: { code: 'ENOAUDIT' } }],
  ['null error alongside a clean-looking report', { ...report(), error: null }],
  ['invalid JSON', '{'],
  ['empty output', ''],
  ['null report', null],
  ['missing report fields', {}],
  ['unsupported report version', { ...report(), auditReportVersion: 3 }],
  ['missing vulnerability map', { ...report(), vulnerabilities: undefined }],
  ['array vulnerability map', { ...report(), vulnerabilities: [] }],
  ['missing metadata', { ...report(), metadata: undefined }],
  ['missing severity counts', { ...report(), metadata: { vulnerabilities: { total: 0 } } }],
  ['mismatched totals', { ...report(), metadata: { vulnerabilities: { ...report().metadata.vulnerabilities, total: 1 } } }],
  ['mismatched severity counts', {
    ...report({ 'fixture-package': vulnerability() }),
    metadata: { vulnerabilities: { info: 0, low: 1, moderate: 0, high: 0, critical: 0, total: 1 } },
  }],
  ['unknown severity', report({ 'fixture-package': { ...vulnerability(), severity: 'unknown' } })],
  ['mismatched name', report({ 'fixture-package': { ...vulnerability(), name: 'other' } })],
  ['missing advisory chain', report({ 'fixture-package': { ...vulnerability(), via: [] } })],
  ['missing advisory source', report({ 'fixture-package': { ...vulnerability(), via: [{}] } })],
  ['understated advisory severity', report({ 'fixture-package': { ...vulnerability(), severity: 'low' } })],
  ['missing inherited package', report({ 'fixture-package': { ...vulnerability(), via: ['missing'] } })],
];
for (const [description, body] of malformedReports) {
  test(`fails closed on ${description}`, (t) => {
    const result = runGate(t, { body, exit: 1 });
    assert.equal(result.status, 1, result.stderr);
    assert.doesNotMatch(result.stdout, /OK/);
    assert.match(result.stderr, /Ogiltigt resultat|Fick ingen utdata/);
  });
}

test('an error exit with clean-looking JSON does not pass', (t) => {
  const result = runGate(t, { exit: 2 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /kunde inte slutföras/);
});

test('a terminated npm process does not pass with clean-looking JSON', (t) => {
  const result = runGate(t, { signal: 'SIGTERM' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /kunde inte slutföras/);
});

test('npm exit1 without any reported vulnerability is incomplete evidence', (t) => {
  const result = runGate(t, { exit: 1 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Ogiltigt resultat/);
});

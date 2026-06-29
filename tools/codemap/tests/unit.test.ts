import { describe, it, expect } from 'vitest';
import { GraphSchema, type Graph } from '../src/types.js';
import { resolveRepoRoot, LAYER_ORDER } from '../src/config.js';
import { extractTables } from '../src/extract/routes.js';
import { prefixFromFragment } from '../src/extract/apiClient.js';
import { parseMigrationTables } from '../src/extract/database.js';
import { impact } from '../src/graph/traverse.js';
import { classifyDomain } from '../src/domain.js';

describe('GraphSchema', () => {
  it('accepterar en giltig graf och avvisar dangling edges', () => {
    const ok: Graph = {
      nodes: [
        { id: 'a', label: 'a', layer: 'frontend-page', source: 'auto' },
        { id: 'b', label: 'b', layer: 'api-route', source: 'auto' },
      ],
      edges: [{ source: 'a', target: 'b', kind: 'calls' }],
    };
    expect(() => GraphSchema.parse(ok)).not.toThrow();
    expect(() => GraphSchema.parse({ nodes: [{ id: 'a', label: 'a', layer: 'service' }], edges: [{ source: 'a', target: 'x', kind: 'calls' }] })).toThrow(/okänd nod/i);
  });
});

describe('config', () => {
  it('faller tillbaka två nivåer upp och respekterar explicit', () => {
    const saved = process.env.CODEMAP_REPO;
    delete process.env.CODEMAP_REPO; // isolera den rena fallback-logiken från ambient env
    try {
      expect(resolveRepoRoot(undefined, '/x/it-system/tools/codemap')).toBe('/x/it-system');
      expect(resolveRepoRoot('/custom', '/x/it-system/tools/codemap')).toBe('/custom');
      expect(LAYER_ORDER['frontend-page']).toBeLessThan(LAYER_ORDER['db-table']);
    } finally {
      if (saved !== undefined) process.env.CODEMAP_REPO = saved;
    }
  });
});

describe('extractTables', () => {
  it('skiljer reads från writes', () => {
    expect(extractTables('SELECT * FROM companies c JOIN contacts ct ON ct.company_id = c.id')).toEqual({
      reads: ['companies', 'contacts'],
      writes: [],
    });
    const w = extractTables('UPDATE tickets SET x = 1 WHERE id = ?');
    expect(w.writes).toContain('tickets');
    const d = extractTables('DELETE FROM sessions WHERE id = ?');
    expect(d.writes).toContain('sessions');
    expect(d.reads).not.toContain('sessions');
  });
});

describe('prefixFromFragment', () => {
  it('härleder /api/<seg>', () => {
    expect(prefixFromFragment('/companies')).toBe('/api/companies');
    expect(prefixFromFragment('/billing/invoices/123')).toBe('/api/billing');
    expect(prefixFromFragment('/')).toBe(null);
  });
});

describe('parseMigrationTables', () => {
  it('mappar tabell -> migrations-id för CREATE och ALTER', () => {
    const src = `export const migrations = [
      { id: '001', up: (db) => { db.exec('CREATE TABLE IF NOT EXISTS ticket_attachments (id TEXT)'); }},
      { id: '063', up: (db) => { db.exec('CREATE TABLE invoices (id TEXT)'); db.exec('ALTER TABLE tickets ADD COLUMN billable INTEGER'); }},
    ];`;
    const map = parseMigrationTables(src);
    expect(map['ticket_attachments']).toContain('001');
    expect(map['invoices']).toContain('063');
    expect(map['tickets']).toContain('063');
  });
});

describe('classifyDomain', () => {
  it('mappar noder till rätt domän med prioritetsordning', () => {
    expect(classifyDomain('CompanyList', 'page:CompanyList')).toBe('företag');
    expect(classifyDomain('/api/companies', 'route:/api/companies')).toBe('företag');
    expect(classifyDomain('useTickets', 'hook:useTickets')).toBe('tickets');
    expect(classifyDomain('slaScheduler', 'service:slaScheduler')).toBe('sla'); // sla före automation
    expect(classifyDomain('ticketNotifications', 'service:ticketNotifications')).toBe('tickets'); // tickets före notiser
    expect(classifyDomain('/api/billing', 'route:/api/billing')).toBe('fakturering');
    expect(classifyDomain('aiHelper', 'service:aiHelper')).toBe('ai');
    expect(classifyDomain('zzz', 'service:zzz')).toBe('övrigt');
  });
});

describe('impact', () => {
  const g: Graph = {
    nodes: ['page', 'hook', 'api', 'route', 'svc', 'tbl'].map((id) => ({ id, label: id, layer: 'service' as const, source: 'auto' as const })),
    edges: [
      { source: 'page', target: 'hook', kind: 'calls' },
      { source: 'hook', target: 'api', kind: 'calls' },
      { source: 'api', target: 'route', kind: 'calls' },
      { source: 'route', target: 'svc', kind: 'uses' },
      { source: 'route', target: 'tbl', kind: 'reads' },
      { source: 'svc', target: 'tbl', kind: 'reads' },
    ],
  };
  it('nedströms och uppströms, exkl. startnod, cykelsäkert', () => {
    expect([...impact(g, 'route').downstream].sort()).toEqual(['svc', 'tbl']);
    expect([...impact(g, 'tbl').upstream].sort()).toEqual(['api', 'hook', 'page', 'route', 'svc']);
    const cyc: Graph = { nodes: [{ id: 'a', label: 'a', layer: 'service', source: 'auto' }, { id: 'b', label: 'b', layer: 'service', source: 'auto' }], edges: [{ source: 'a', target: 'b', kind: 'uses' }, { source: 'b', target: 'a', kind: 'uses' }] };
    expect([...impact(cyc, 'a').downstream]).toEqual(['b']);
  });
});

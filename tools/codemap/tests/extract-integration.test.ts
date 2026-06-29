import { describe, it, expect } from 'vitest';
import { buildAutoGraph } from '../src/extract/index.js';
import { resolveRepoRoot } from '../src/config.js';
import { GraphSchema } from '../src/types.js';

describe('buildAutoGraph (riktiga repot)', () => {
  const graph = buildAutoGraph(resolveRepoRoot());

  it('producerar en schemagiltig graf', () => {
    expect(() => GraphSchema.parse(graph)).not.toThrow();
    expect(graph.nodes.length).toBeGreaterThan(80);
  });

  it('innehåller kända noder från riktiga koden', () => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    expect(ids.has('page:CompanyList')).toBe(true);
    expect(ids.has('route:/api/companies')).toBe(true);
    expect(ids.has('table:tickets')).toBe(true);
  });

  it('kopplar ihop frontend → companies-route (minst en inkommande edge)', () => {
    expect(graph.edges.filter((e) => e.target === 'route:/api/companies').length).toBeGreaterThan(0);
  });

  it('alla edges refererar existerande noder', () => {
    const ids = new Set(graph.nodes.map((n) => n.id));
    const dangling = graph.edges.filter((e) => !ids.has(e.source) || !ids.has(e.target));
    expect(dangling).toEqual([]);
  });
});

import { describe, it, expect } from 'vitest';
import { mergeGraphs } from '../src/merge.js';
import { renderHtml } from '../src/build.js';
import type { Graph } from '../src/types.js';

const auto: Graph = {
  nodes: [
    { id: 'page:CompanyList', label: 'CompanyList', layer: 'frontend-page', source: 'auto' },
    { id: 'route:/api/tickets', label: '/api/tickets', layer: 'api-route', source: 'auto' },
    { id: 'route:/api/email-inbound', label: '/api/email-inbound', layer: 'api-route', source: 'auto' },
  ],
  edges: [],
};

describe('mergeGraphs', () => {
  it('berikar noder, lägger till business-edges, validerar referenser', () => {
    const m = mergeGraphs(auto, {
      nodes: [{ id: 'page:CompanyList', feature: 'Företag', description: 'Listar företag.' }],
      edges: [{ source: 'route:/api/email-inbound', target: 'route:/api/tickets', kind: 'business' }],
      features: { Företag: { color: '#123456' } },
    });
    const node = m.nodes.find((n) => n.id === 'page:CompanyList')!;
    expect(node.feature).toBe('Företag');
    expect(node.source).toBe('merged');
    expect(m.edges).toContainEqual({ source: 'route:/api/email-inbound', target: 'route:/api/tickets', kind: 'business' });
    expect(() => mergeGraphs(auto, { nodes: [{ id: 'page:Saknas', feature: 'X' }] })).toThrow(/okänd nod/i);
  });
});

describe('renderHtml', () => {
  it('injicerar delar och escapar </script>', () => {
    const tpl = '<style>/* __STYLES__ */</style><script>/* __CYTOSCAPE_JS__ */</script><script>/* __FCOSE_JS__ */</script><script>window.__GRAPH__ = /* __GRAPH_JSON__ */ null;</script><script>/* __APP_JS__ */</script>';
    const html = renderHtml({
      template: tpl, cytoscapeJs: 'CYTO', fcoseJs: 'FCOSE', appJs: 'APP', styles: 'CSS',
      graph: { nodes: [{ id: '</script>', label: 'x', layer: 'service', source: 'auto' }], edges: [], features: {} },
    });
    expect(html).toContain('CYTO');
    expect(html).toContain('APP');
    expect(html).toContain('CSS');
    expect(html).not.toContain('__GRAPH_JSON__');
    expect(html.indexOf('</script></script>')).toBe(-1);
    expect(html).toContain('<\\/script>');
  });
});

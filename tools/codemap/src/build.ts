import fs from 'node:fs';
import path from 'node:path';
import type { MergedGraph } from './merge.js';

export interface RenderInput {
  template: string;
  cytoscapeJs: string;
  fcoseJs: string;
  appJs: string;
  styles: string;
  graph: MergedGraph;
}

export function renderHtml(input: RenderInput): string {
  const json = JSON.stringify(input.graph).replace(/<\/script>/gi, '<\\/script>');
  return input.template
    .replace('/* __CYTOSCAPE_JS__ */', () => input.cytoscapeJs)
    .replace('/* __FCOSE_JS__ */', () => input.fcoseJs)
    .replace('/* __APP_JS__ */', () => input.appJs)
    .replace('/* __STYLES__ */', () => input.styles)
    .replace('/* __GRAPH_JSON__ */ null', () => json);
}

// CLI: läs alla delar -> dist/codemap.html
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = path.join(path.dirname(new URL(import.meta.url).pathname), '..');
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
  const html = renderHtml({
    template: read('template/codemap.html'),
    cytoscapeJs: read('vendor/cytoscape.min.js'),
    fcoseJs: read('vendor/fcose.min.js'),
    appJs: read('template/app.js'),
    styles: read('template/styles.css'),
    graph: JSON.parse(read('graph.json')),
  });
  fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
  fs.writeFileSync(path.join(root, 'dist/codemap.html'), html);
  console.log(`Wrote dist/codemap.html (${(html.length / 1024).toFixed(0)} KB)`);
}

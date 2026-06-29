import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { GraphSchema, type Graph, type GraphEdge } from './types.js';

export interface Overlay {
  nodes?: { id: string; feature?: string; description?: string }[];
  edges?: GraphEdge[];
  features?: Record<string, { color?: string }>;
}

export interface MergedGraph extends Graph {
  features: Record<string, { color?: string }>;
}

export function mergeGraphs(auto: Graph, overlay: Overlay): MergedGraph {
  const nodeMap = new Map(auto.nodes.map((n) => [n.id, { ...n }]));
  for (const o of overlay.nodes ?? []) {
    const existing = nodeMap.get(o.id);
    if (!existing) throw new Error(`Curated overlay refererar okänd nod: ${o.id}`);
    if (o.feature) existing.feature = o.feature;
    if (o.description) existing.description = o.description;
    existing.source = 'merged';
  }
  const edges = [...auto.edges];
  for (const e of overlay.edges ?? []) {
    if (!nodeMap.has(e.source) || !nodeMap.has(e.target))
      throw new Error(`Curated edge refererar okänd nod: ${e.source} -> ${e.target}`);
    edges.push(e);
  }
  const merged = { nodes: [...nodeMap.values()], edges };
  GraphSchema.parse(merged); // referentiell integritet
  return { ...merged, features: overlay.features ?? {} };
}

// CLI: läs graph.auto.json + overlay.yaml -> graph.json
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = path.dirname(new URL(import.meta.url).pathname);
  const auto = JSON.parse(fs.readFileSync(path.join(dir, '..', 'graph.auto.json'), 'utf8')) as Graph;
  const overlayPath = path.join(dir, '..', 'curated', 'overlay.yaml');
  const overlay = (fs.existsSync(overlayPath) ? (parseYaml(fs.readFileSync(overlayPath, 'utf8')) ?? {}) : {}) as Overlay;
  const merged = mergeGraphs(auto, overlay);
  fs.writeFileSync(path.join(dir, '..', 'graph.json'), JSON.stringify(merged, null, 2));
  console.log(`Merged -> graph.json (${merged.nodes.length} nodes, ${merged.edges.length} edges)`);
}

import type { Graph } from '../types.js';

export interface ImpactResult {
  downstream: Set<string>; // noder startnoden påverkar (följ edges framåt)
  upstream: Set<string>; // noder som påverkar startnoden (följ edges bakåt)
}

function bfs(adj: Map<string, string[]>, start: string): Set<string> {
  const seen = new Set<string>();
  const queue = [...(adj.get(start) ?? [])];
  while (queue.length) {
    const n = queue.shift()!;
    if (n === start || seen.has(n)) continue;
    seen.add(n);
    for (const next of adj.get(n) ?? []) if (!seen.has(next)) queue.push(next);
  }
  seen.delete(start);
  return seen;
}

export function impact(graph: Graph, nodeId: string): ImpactResult {
  const forward = new Map<string, string[]>();
  const backward = new Map<string, string[]>();
  const push = (m: Map<string, string[]>, k: string, v: string) => {
    const a = m.get(k);
    if (a) a.push(v);
    else m.set(k, [v]);
  };
  for (const e of graph.edges) {
    push(forward, e.source, e.target);
    push(backward, e.target, e.source);
  }
  return { downstream: bfs(forward, nodeId), upstream: bfs(backward, nodeId) };
}

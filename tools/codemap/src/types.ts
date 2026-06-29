import { z } from 'zod';

export const LAYERS = [
  'frontend-page',
  'frontend-hook',
  'api-client',
  'api-route',
  'service',
  'scheduler',
  'db-table',
  'ai',
  'deploy',
] as const;
export type Layer = (typeof LAYERS)[number];

export const EDGE_KINDS = [
  'imports', // A importerar B
  'calls', // A anropar B (hook->api, api->route)
  'uses', // route->service, service->service
  'reads', // kod->tabell (SELECT)
  'writes', // kod->tabell (INSERT/UPDATE/DELETE)
  'creates', // migration->tabell
  'triggers', // scheduler->service/route
  'business', // manuell affärskoppling från curated-lagret
] as const;
export type EdgeKind = (typeof EDGE_KINDS)[number];

export const NodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  layer: z.enum(LAYERS),
  file: z.string().optional(),
  loc: z.string().optional(), // fil:rad, t.ex. "src/lib/api.ts:142"
  domain: z.string().optional(), // affärsdomän för gruppering, t.ex. "tickets"
  feature: z.string().optional(), // sätts oftast av curated-lagret
  description: z.string().optional(), // sätts oftast av curated-lagret
  source: z.enum(['auto', 'curated', 'merged']).default('auto'),
});
export type GraphNode = z.infer<typeof NodeSchema>;

export const EdgeSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  kind: z.enum(EDGE_KINDS),
});
export type GraphEdge = z.infer<typeof EdgeSchema>;

export const GraphSchema = z
  .object({ nodes: z.array(NodeSchema), edges: z.array(EdgeSchema) })
  .superRefine((g, ctx) => {
    const ids = new Set(g.nodes.map((n) => n.id));
    for (const e of g.edges) {
      if (!ids.has(e.source))
        ctx.addIssue({ code: 'custom', message: `Edge refererar okänd nod (source): ${e.source}` });
      if (!ids.has(e.target))
        ctx.addIssue({ code: 'custom', message: `Edge refererar okänd nod (target): ${e.target}` });
    }
  });
export type Graph = z.infer<typeof GraphSchema>;

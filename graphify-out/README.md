> Snapshoten föregår kodstädningen 2026-10-06. `.needs_update` markerar att den måste uppdateras innan nya slutsatser om dessa symboler dras.

# IT-Ticket Graphify snapshot

Open `graph.html` in a browser; the viewer loads vis-network from unpkg.com.

- `graph.json`: 678 nodes and 1,300 preserved extracted relations.
- `GRAPH_REPORT.md`: communities, evidence, domain validation and limitations.
- `scope.json`: the exact 30 selected inputs.
- `extraction.json`: raw AST and semantic provenance.
- `diagnostics.json`: reference and edge-collapse diagnostics.
- `manifest.json`: fingerprints of the selected source snapshot.
- `cost.json`: honest token accounting; semantic usage is unavailable.
- `benchmark.json`: heuristic query compression estimate.

Run `/Users/anton/.local/bin/graphify query "<terms from node labels>"` from the repository root.

For rebuilds, read `scope.json` and restrict detection/extraction to its file list before following the Graphify skill. A bare `graphify update .` expands to the whole repository and does not preserve this selected-file scope. Semantic extraction must also include the glossary and SQL schema; rerun it when relevant behavior changes.

This is a navigation aid, not proof of complete coverage or correct authorization. The initial graph build did not modify application code or the existing architecture map. Subsequent cleanup is recorded by `.needs_update`.

> **Stale snapshot (2026-10-06):** source cleanup removed some API helpers/types and extracted shared list navigation. See `.needs_update`; verify current source before using symbol locations or caller claims.

# Graph Report - it-system  (2026-10-06)

## Corpus Check
- Large corpus: 921 files · ~971,812 words. Semantic extraction will be expensive (many Claude tokens). Consider running on a subfolder.

## Summary
- 678 nodes · 1277 edges · 24 communities (15 shown, 9 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 54 edges (avg confidence: 0.91)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Klientens API-anrop
- Ärendets detaljvy
- E-post och ärendestatus
- Utgående e-post
- Domänbegrepp och kommunikation
- Ärendeurval och import
- Klientens datatyper
- Status och ärendetyper
- Kö och statusmärken
- Kontakter och kommentarer
- Publik ärendedelning
- Publikt ärendeskapande
- Ärendecache och uppdatering
- Ärendenas åtkomst
- Användarkonton
- Autentisering av anrop
- Aktiv ärendekö
- Ärendets åtgärder
- Kunskapsbasens API-typer

## God Nodes (most connected - your core abstractions)
1. `ApiClient` - 161 edges
2. `processEmail()` - 16 edges
3. `sendTicketReminderEmail()` - 14 edges
4. `formatTicketHtml()` - 13 edges
5. `TicketDetail()` - 13 edges
6. `Ärende` - 12 edges
7. `sendTicketReplyEmail()` - 11 edges
8. `sendAgentReplyNotificationEmail()` - 11 edges
9. `authenticate()` - 10 edges
10. `getBrandName()` - 9 edges

## Surprising Connections (you probably didn't know these)
- `rowIsAccessible()` --conceptually_related_to--> `Beställare`  [AMBIGUOUS]
  server/src/lib/ticketAccess.ts → GLOSSARY.md
- `processEmail()` --implements--> `Beställare`  [INFERRED]
  server/src/lib/emailInbound.ts → GLOSSARY.md
- `processEmail()` --implements--> `Skapare`  [INFERRED]
  server/src/lib/emailInbound.ts → GLOSSARY.md
- `canAccessTicket()` --implements--> `Handläggare`  [INFERRED]
  server/src/lib/ticketAccess.ts → GLOSSARY.md
- `notifyAgentOfCustomerReply()` --implements--> `Handläggare`  [INFERRED]
  server/src/lib/ticketNotifications.ts → GLOSSARY.md

## Import Cycles
- None detected.

## Communities (24 total, 9 thin omitted)

### Community 2 - "E-post och ärendestatus"
Cohesion: 0.05
Nodes (37): Öppet ärende, Ärendestatus, Aktivt ärende, Avslutat ärende, Inkommande e-postsvar, Lösning, Löst ärende, Stängt ärende (+29 more)

### Community 3 - "Utgående e-post"
Cohesion: 0.17
Nodes (31): RFC-5322, buildBadge(), buildCta(), buildEmailShell(), buildInfoRow(), buildTicketContent(), createTransporter(), escapeHtml() (+23 more)

### Community 4 - "Domänbegrepp och kommunikation"
Cohesion: 0.07
Nodes (32): Ärende, Ärendehistorik, Ärendekategori, Ärendekommentar, Ärendemall, Användare, Beställare, Delningslänk för ärende (+24 more)

### Community 5 - "Ärendeurval och import"
Cohesion: 0.09
Nodes (24): CategoryLookup, ContactLookup, generateXLSX(), normalizeFieldNames(), parseCSV(), parseCSVLine(), TicketRow, validateTicketRow() (+16 more)

### Community 6 - "Klientens datatyper"
Cohesion: 0.07
Nodes (29): ApiKeyRow, ApiOptions, AttachmentRow, AuthUser, BackupConfig, CategoryRow, ChecklistRow, ChecklistTemplate (+21 more)

### Community 9 - "Status och ärendetyper"
Cohesion: 0.10
Nodes (20): Prioritet, PriorityBadgeProps, StatusBadgeProps, UseTicketsOptions, getTicketScope(), ticketTabLink(), CommentRow, CustomFieldInput (+12 more)

### Community 10 - "Kö och statusmärken"
Cohesion: 0.13
Nodes (7): PriorityBadge(), priorityClasses, priorityLabels, StatusBadge(), statusClasses, statusLabels, TicketQueueTable()

### Community 11 - "Kontakter och kommentarer"
Cohesion: 0.14
Nodes (10): AuthRequest, requireAdmin(), CategoryRow, router, CommentRow, ContactRow, parseCSV(), parseCSVLine() (+2 more)

### Community 12 - "Publik ärendedelning"
Cohesion: 0.12
Nodes (10): AttachmentFullRow, AttachmentRow, CategoryRow, ChecklistRow, ContactRow, __dirname, __filename, sharePublicRateLimiter (+2 more)

### Community 14 - "Publikt ärendeskapande"
Cohesion: 0.13
Nodes (7): CategoryRow, ContactRow, CustomFieldInput, idempotencyStore, publicBrandingReadRateLimiter, router, TemplateRow

### Community 15 - "Ärendecache och uppdatering"
Cohesion: 0.17
Nodes (8): applyOptimisticRow(), buildAddTicketMutationOptions(), buildDeleteTicketMutationOptions(), buildUpdateTicketMutationOptions(), ticketKeys, useTickets(), CustomFieldInput, Archive()

### Community 17 - "Ärendenas åtkomst"
Cohesion: 0.26
Nodes (9): canAccessTicket(), filterAccessibleTicketIds(), rowIsAccessible(), TicketAccessRequest, TicketAccessRow, ApiKeyIdentity, AuthUser, isEffectiveAdmin() (+1 more)

### Community 19 - "Autentisering av anrop"
Cohesion: 0.22
Nodes (8): createApp(), ApiKeyAuthResult, authenticate(), Express, isApiKeyRequest(), Request, tryApiKeyAuth(), WRITE_METHODS

### Community 20 - "Aktiv ärendekö"
Cohesion: 0.22
Nodes (4): activeQueueKeys, api, PaginatedResponse, TicketRow

### Community 23 - "Kunskapsbasens API-typer"
Cohesion: 0.67
Nodes (3): KbPortalArticle, KbPortalArticleBase, KbPortalArticleSummary

## Ambiguous Edges - Review These
- `rowIsAccessible()` → `Beställare`  [AMBIGUOUS]
  server/src/lib/ticketAccess.ts · relation: conceptually_related_to

## Knowledge Gaps
- **95 isolated node(s):** `TicketEmailPayload`, `T`, `EmailConfig`, `emailFailureCounts`, `ImapClientLike` (+90 more)
  These have ≤1 connection - possible missing edges. (Counts symbols only; 283 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **9 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **What is the exact relationship between `rowIsAccessible()` and `Beställare`?**
  _Edge tagged AMBIGUOUS (relation: conceptually_related_to) - confidence is low._
- **Why does `ApiClient` connect `Klientens API-anrop` to `Uppladdning och import`, `Sessioner och nedladdning`, `Klientens datatyper`, `Ärendets åtgärder`?**
  _High betweenness centrality (0.325) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `processEmail()` (e.g. with `emailInbound.ts` and `Beställare`) actually correct?**
  _`processEmail()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `TicketEmailPayload`, `T`, `EmailConfig` to the rest of the system?**
  _95 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Klientens API-anrop` be split into smaller, more focused modules?**
  _Cohesion score 0.03005366726296959 - nodes in this community are weakly interconnected._
- **Why does `TicketComments` connect `Domänbegrepp och kommunikation` to `Kommentarernas redigering`, `Ärendets detaljvy`, `Ärendets åtgärder`?**
  _High betweenness centrality (0.301) - this node is a cross-community bridge._
- **Should `Ärendets detaljvy` be split into smaller, more focused modules?**
  _Cohesion score 0.022727272727272728 - nodes in this community are weakly interconnected._
## Scope and integrity limits

This is a selected-file snapshot of ticket handling, not the full repository.
The 30 input files are listed in `scope.json`; the SQL schema was explicitly
included for semantic reading. Shared API and application modules also contain
references to unrelated areas. Those references are not evidence that those
areas were analyzed. Placeholder dependency nodes have no verified source body.

The extractor reported 304 dangling endpoints, 63 external-reference edges,
4 self-loops, and 22 same-endpoint edge groups. Unscanned dependency endpoints
are materialized as reference nodes. The simple graph used for clustering
coalesces parallel relationships, but all extracted relationships are preserved
in `graph.json` and `extraction.json`. See `diagnostics.json` for exact counts.
This graph is useful for navigation; it does not prove complete code coverage
or absence of bugs. Read the cited source before changing behavior.

## Token accounting clarification

Structural AST extraction uses no LLM tokens. Semantic extraction ran in the
host session; its actual input/output usage is unavailable from the agent tool.
Zeros in the generated token-cost section are placeholders, not measured
semantic usage. No paid external LLM backend was invoked.

## Domain validation against GLOSSARY.md

| Relationship | Finding | Source |
| --- | --- | --- |
| Contact / requester vs user / assignee / creator | Glossary agrees with the schema. | server/src/db/schema.sql:L64,L74,L88 |
| Active vs completed | Active = open/in-progress/waiting; completed = resolved/closed. | src/lib/ticketNavigation.ts:L4,L8 |
| Closing vs solving | No preceding resolved status or solution text required by the update handler; agrees with the user-confirmed distinction. | server/src/routes/tickets.ts:L1159,L1167,L1179 |
| Reply vs public sharing | Shared ticket view excludes internal notes and does not include comments. | server/src/routes/shares.ts:L220,L226 |

### Behavior to assess in future work

1. Inbound replies can be attached to closed tickets by message-ID or short-ID. Subject-only fallback excludes closed tickets. Reply insertion preserves status, so an incoming follow-up can remain in the completed view. Sources: server/src/lib/emailInbound.ts:L100,L113,L135,L176,L270. This describes current code, not an agreed reopening policy.
2. The UI reports `Svar skickat till kund` after a public comment is saved. Email sending runs asynchronously and can be skipped or fail, so the message is not delivery confirmation. Sources: src/components/TicketComments.tsx:L46; server/src/routes/comments.ts:L132; server/src/lib/ticketNotifications.ts:L37.
3. `rowIsAccessible` compares contact-backed `requester_id` to a login-user ID. The selected sources do not establish how those identities would be linked. The graph marks this AMBIGUOUS; it is not a demonstrated authorization defect. Source: server/src/lib/ticketAccess.ts:L28.

### Verification

Graph JSON parses, node IDs are unique, and all exported link endpoints exist. Inline HTML JavaScript parses without syntax errors using tree-sitter. No connected browser was available, so rendering and interactions were not visually tested. The HTML loads vis-network from unpkg.com. The benchmark estimate is 5.9x fewer tokens per query (44,790 corpus words); this is a heuristic, not measured session usage.

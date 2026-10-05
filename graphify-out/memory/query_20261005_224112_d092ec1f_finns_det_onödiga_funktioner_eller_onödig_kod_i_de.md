---
type: "query"
date: "2026-10-05T22:41:12.840373+00:00"
question: "Finns det onödiga funktioner eller onödig kod i detta projekt?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["ApiClient", "Template", "RequesterAnalytics"]
---

# Q: Finns det onödiga funktioner eller onödig kod i detta projekt?

## Answer

Ponytail read-only simplification review. Expanded graph vocab: [client, api, import, export, tag, template, requester]. Graph ApiClient hub guided API inspection; field query surfaced Template, RequesterAnalytics and TagRow. Whole-repository static imports/source searches supplement the selected-file graph. Candidates: src/types/ticket.ts RequesterAnalytics L20, TicketLinkRow L129 and TemplateRow L165 are not imported; active analytics/link/template consumers use api.ts row types. src/lib/api.ts getContact L774 and getAttachmentUrl L889 have no frontend production callers; URL builder has test-only callers. OnboardingWizard.tsx L80 asks every fresh browser user to create a customer company despite internal-support direction; feature removal is a product recommendation, not proven non-use. TicketList.tsx L94 and Archive.tsx L95 duplicate filter/pagination handling; consolidate only shared behavior. tickets.ts L62 still selects six retired SLA fields ignored by frontend; validate external API contracts before removing fields. Historical tables, migrations, ticket-tag export and KB tag protections are intentional per Obsidian 2026-09-08 decisions and must be retained. No orphan production modules or dependency packages absent from source references found by static scan. Runtime usage unknown; compiler/tests unavailable because Node and dependencies are absent. No application code changed.

## Outcome

- Signal: useful

## Source Nodes

- ApiClient
- Template
- RequesterAnalytics
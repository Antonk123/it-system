---
type: "query"
date: "2026-10-05T22:37:22.991863+00:00"
question: "Varför kan ett nytt e-postsvar på ett avslutat ärende bli kvar bland avslutade ärenden?"
contributor: "graphify"
outcome: "useful"
source_nodes: ["processEmail()", "addCommentToTicket()", "ticketViews"]
---

# Q: Varför kan ett nytt e-postsvar på ett avslutat ärende bli kvar bland avslutade ärenden?

## Answer

Graph navigation test, known-case demonstration. Expanded from graph vocabulary: [inkommande, svar, status, closed, subject, message]. Queried inkommande svar status: 79 nodes; broad output was noisy, so narrowed using explain on Inkommande svar ändrar inte status, E-posttrådning and Avslutat ärende plus an undirected conceptual path. Relevant nodes led to processEmail (emailInbound.ts L267), addCommentToTicket (L160/L176) and ticketViews (ticketNavigation.ts L8). Source inspection confirmed message-ID and short-ID matching do not filter closed status (L100/L113); subject fallback excludes closed only (L135); a reply inserts a comment and changes updated_at without changing status (L171/L176). Archive.tsx L30/L54 uses resolved/closed selected by getTicketScope, so completed tickets stay completed after matched replies. This is static source verification and graph navigation, not an executed email integration test or a newly discovered defect. No application code changed.

## Outcome

- Signal: useful

## Source Nodes

- processEmail()
- addCommentToTicket()
- ticketViews
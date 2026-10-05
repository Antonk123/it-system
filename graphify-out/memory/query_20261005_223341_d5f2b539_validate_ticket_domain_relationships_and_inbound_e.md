---
type: "query"
date: "2026-10-05T22:33:41.967204+00:00"
question: "Validate ticket domain relationships and inbound email status behavior"
contributor: "graphify"
outcome: "useful"
source_nodes: ["processEmail()", "rowIsAccessible()", "Beställare"]
---

# Q: Validate ticket domain relationships and inbound email status behavior

## Answer

Expanded from graph vocabulary: [email, reply, closed, subject, message, access, requester, user]. Selected-file graph confirms requester is a contact, assignee/creator are login users; active=open/in-progress/waiting and completed=resolved/closed. Inbound email matching by message-ID or short-ID permits closed tickets, subject fallback excludes closed; adding a reply updates updated_at but preserves status (emailInbound.ts L96,L108,L123,L176,L255). Public reply saving and email delivery are distinct (TicketComments.tsx L46; comments.ts L132; ticketNotifications.ts L37). rowIsAccessible compares contact requester_id with login user.id (ticketAccess.ts L28); no contact-to-user linkage is demonstrated in this scope, so this remains AMBIGUOUS, not a confirmed security bug.

## Outcome

- Signal: useful

## Source Nodes

- processEmail()
- rowIsAccessible()
- Beställare
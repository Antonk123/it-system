# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two distinct audiences, both internal to Prefabmästarna (a Swedish prefab-construction company), no external customers:

1. **IT support staff** (a small team: 1 admin + a couple of agents in practice) — triage, assign, and resolve IT tickets every working day. Power users of this specific tool, high frequency, desktop-primary with real mobile use for quick checks/updates. This is their daily work surface (Operate mode).
2. **General Prefabmästarna employees** — submit IT tickets and read help articles occasionally, not daily. Low familiarity with the tool, no login for ticket submission or the public knowledge base. Task is narrow (report a problem, find an answer) and infrequent (Operate mode for the submission form: completing one task; Read mode for the public knowledge base: understanding something).

No multi-tenancy, no external customers, one deployment per install (this specific instance serves only Prefabmästarna).

## Product Purpose

Internal IT ticketing system ("Ärendesystem"/"IT-ärenden"): tickets, knowledge base, email-to-ticket, and the practical workflows around them. SLA tracking, invoicing, and time registration existed historically and were deliberately retired (historical data preserved, not exposed as active features) — the product's current purpose is lean day-to-day IT support, not a billable-services/MSP tool.

Success = IT staff can triage and resolve tickets fast with an accurate at-a-glance read of urgency (priority/status), and regular employees can report a problem or find an answer without training.

## Positioning

Not a generic off-the-shelf ticketing SaaS (Zendesk/Freshdesk-style) reskinned — it is purpose-built for one company's specific IT workflows, Swedish terminology, and category taxonomy (Mjukvara/Nätverk/Hårdvara/Behörigheter/Övrigt), with no multi-tenant abstraction to serve. A neighboring generic SaaS ticketing tool could not truthfully claim to be built specifically around Prefabmästarna's own support process.

## Operating Context

- IT staff work the queue continuously through the day: Kanban board and table list for triage, ⌘K command palette for fast navigation, bulk actions on multiple tickets at once, drag-and-drop status changes.
- Tickets arrive via the internal form, via email (IMAP/M365 inbox polling), and are triaged, assigned, commented on, checklisted, and resolved.
- Regular employees hit the public ticket-submission form and public knowledge base rarely, unauthenticated, often from a phone, with no prior exposure to the tool.
- Historical SLA/billing data exists in the database from a retired feature set and must not be resurfaced as active UI.

## Capabilities and Constraints

- React 19 + TypeScript + Vite + Tailwind CSS + shadcn/ui (Radix primitives) + Framer Motion + TipTap + @tanstack/react-query on the frontend; Node/Express/SQLite backend. This stack is fixed — the redesign works within it, not around it.
- An existing multi-theme system already exists (`theme-default`, `theme-midnight`, `theme-graphite`, `theme-stone`, `theme-linear`, `theme-spotify` + independent light/dark mode + 5 font choices), all CSS-custom-property driven from `src/index.css`. The new visual identity should follow this same token architecture (add to it or replace it cleanly), not bypass it with one-off inline styles.
- Admin-configurable branding exists (`BRAND_NAME` env var, admin-uploadable logo via settings) but nothing is set by default beyond a generic placeholder mark and the literal name "IT-Support"/"IT-ärenden" — there is no locked-in visual identity to preserve today.
- An embedding bridge (`prefabnavet-theme.css`) lets this app inherit CSS-variable palettes when iframed inside a separate internal portal ("PrefabNavet"). This is a technical integration surface, not brand evidence — the palettes it lists (bibliotek, violett, odysseus, terminal, gpt, claude) are generic named presets, not Prefabmästarna's corporate identity, and are out of scope for this redesign (that CSS file is not touched).
- Accessibility work has been done repeatedly and deliberately (WCAG AA contrast passes, keyboard navigation, screen-reader labels for custom Kanban drag-and-drop) — the redesign must preserve or improve this, never regress it.

## Brand Commitments

None binding today. The current default logo (`src/assets/logo-default.svg`) is a generic abstract mark (three gray bars) with no connection to Prefabmästarna or the prefab-construction industry. The user explicitly chose, for this redesign, a **bespoke identity for the tool itself** — grounded in the prefab-construction/engineering world the company and its IT staff actually work in — rather than reproducing Prefabmästarna's external marketing brand (which was not made available/binding here) or continuing the current generic-SaaS-template default look.

## Evidence on Hand

- A completed `/impeccable critique` of Dashboard + Ärendelista (2026-09-13, `.impeccable/critique/2026-09-13T21-31-38Z__dashboard-ticketlist-core-flow.md`) scored 24/40 on Nielsen's heuristics. Headline findings: the current visual layer reads as generic modern-SaaS-admin-template (glassmorphism, hover-glow KPI cards, decorative corner blobs) sitting oddly on an internal Operate-mode tool; a P0 correctness bug (now fixed) silently stripped all priority/status badge color; ALL-CAPS tracked eyebrow labels and soft-shadow rounded-card chrome are already present as generic-template tells.
- Realistic seeded demo data exists locally for screenshot-based review (12 sample tickets across all statuses/priorities/categories, 2 companies, 4 contacts, 3 users) — not committed, local dev DB only.
- No real Prefabmästarna photography, logo files, brand guide, or approved copy is available in this repo or session; none should be fabricated as if real.

## Product Principles

1. **The queue is the product.** For IT staff, priority/status/ownership must read faster than any decorative element on the page — expression never outranks triage speed.
2. **One tool, two registers.** The same visual world serves both a power user doing this all day (dense, fast, keyboard-capable) and a first-time employee doing it once (plain, guided, forgiving) — the identity must flex without becoming two different products.
3. **Earned specificity, not decoration.** Visual devices should encode real information (a status, a reference, a structural boundary) the way the current generic SaaS chrome (gradients, glow, decorative blobs) does not — nothing ornamental that isn't also functional.
4. **Built for one company's real work, not a template.** The identity should feel authored for Prefabmästarna's IT department specifically, not swappable into any other company's help desk unchanged — this is the standing complaint about prior AI-generated design work in this project (see [[decisions]]).

## Accessibility & Inclusion

WCAG AA contrast is an established, repeatedly-verified standard in this project (see prior audits) and must hold across every new theme/mode combination. Keyboard navigation and screen-reader support for the custom Kanban drag-and-drop (Space/Enter semantics, Swedish `aria-live` announcements) must be preserved exactly, including surfacing its keyboard legend visibly (a gap the critique flagged) rather than only in a screen-reader-only string.

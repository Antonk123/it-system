# Phase 5: Automation — Recurring Tickets & Dashboard Queues - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-03-28
**Phase:** 05-automation-recurring-tickets-dashboard-queues
**Areas discussed:** Schema-design, Köernas beteende, Schemaläggare-UX, Dashboard-layout

---

## Schema-design

### Schema-typ

| Option | Description | Selected |
|--------|-------------|----------|
| Enkla intervall | Daglig, veckovis (välj veckodag), månatlig (välj dag). Täcker 95% av behoven. | ✓ |
| Enkla + cron för avancerat | Samma enkla intervall plus avancerat cron-läge för specialfall. | |
| Kalenderbaserat | Välj specifika datum i en kalender. | |

**User's choice:** Enkla intervall (recommended default)
**Notes:** User accepted recommended option.

### Mallfält

| Option | Description | Selected |
|--------|-------------|----------|
| Samma som vanligt ärende | Titel, beskrivning, prioritet, kategori, taggar. | ✓ |
| Minimalt: titel + beskrivning | Prioritet/kategori/taggar sätts manuellt efter skapande. | |
| Utvidgat med checklista | Samma som vanligt ärende plus en checklista-mall. | |

**User's choice:** Samma som vanligt ärende (recommended default)
**Notes:** User accepted recommended option.

---

## Köernas beteende

### Kö-definition

| Option | Description | Selected |
|--------|-------------|----------|
| Kopplade till filtervyer | En kö = en sparad filtervy. Klick navigerar till filtrerad vy. | ✓ |
| Egna kö-definitioner | Separata filterdefinitioner. Mer flexibelt men dubblerar logik. | |
| Fördefinierade + anpassade | 3-4 standardköer + användardefinierade. | |

**User's choice:** Kopplade till filtervyer (recommended default)
**Notes:** User accepted recommended option.

### Lagring

| Option | Description | Selected |
|--------|-------------|----------|
| localStorage | Samma mönster som filtervyer. Ingen DB-migration. | ✓ |
| Databasen | Persistent över enheter. Kräver ny tabell och API-endpoints. | |

**User's choice:** localStorage (recommended default)
**Notes:** User accepted recommended option.

---

## Schemaläggare-UX

### Placering

| Option | Description | Selected |
|--------|-------------|----------|
| Egen sida i sidomenyn | "Återkommande" som ny menypost. Tydlig separation. | ✓ |
| Under Settings/Inställningar | En flik under inställningar. Mer undangömt. | |
| Knapp på ärendelistan | "Skapa återkommande" bredvid "Nytt ärende". | |

**User's choice:** Egen sida i sidomenyn (recommended default)
**Notes:** User accepted recommended option.

### Historik

| Option | Description | Selected |
|--------|-------------|----------|
| Expanderbar rad | Klicka → expanderar med senaste 5-10 skapade ärenden. | ✓ |
| Separat detaljsida | Öppnar egen sida med full historik och statistik. | |
| Tooltip/popover | Hovra → popover med senaste ärenden. | |

**User's choice:** Expanderbar rad (recommended default)
**Notes:** User accepted recommended option.

---

## Dashboard-layout

### Integration

| Option | Description | Selected |
|--------|-------------|----------|
| Komplettera befintlig layout | Behåll KPI-kort. Köer-sektion ersätter aging-grupper. | ✓ |
| Ersätt aging-grupper helt | Ta bort allt, ersätt med användardefinierade köer. | |
| Sidopanel | KPI-kort vänster, köer höger. | |

**User's choice:** Komplettera befintlig layout
**Notes:** User explicitly selected option 1.

### Kö-visning

| Option | Description | Selected |
|--------|-------------|----------|
| Kompakta kort med antal | Card-komponent med könamn, antal, färgkodning. Klickbar. | ✓ |
| Lista med preview | Varje kö visar 3 senaste ärenden inline. | |
| Bara siffror | Enkel tabell/grid med könamn + antal. | |

**User's choice:** Kompakta kort med antal
**Notes:** User explicitly selected option A.

---

## Claude's Discretion

- Responsive layout for queue cards on mobile
- Animation for expandable history rows
- Scheduler polling interval
- Empty state design
- Queue count fetching strategy

## Deferred Ideas

None — discussion stayed within phase scope.

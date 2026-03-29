# Requirements: IT Ticket System

**Defined:** 2026-03-26
**Core Value:** Every ticket gets tracked, resolved, and documented — nothing falls through the cracks and solutions are reusable.

## v1.1 Requirements

Requirements for milestone v1.1 Quality & Automation. Each maps to roadmap phases.

### Filter & UX

- [x] **FILT-01**: Alla ärenden har en enda konsoliderad filterrad (sök, status, prioritet, kategori, taggar, datum — inga separata snabbfilter eller datumrader)
- [x] **FILT-02**: Aktiva filter visas som kompakta chips som kan tas bort, integrerade i filterraden
- [x] **FILT-03**: Filtervyer (spara/ladda filter-presets) fungerar på både Alla ärenden och Arkiv
- [x] **FILT-04**: Arkiv-sidan har samma filteralternativ som Alla ärenden (prioritet, checklistefilter, datumfilter)
- [x] **FILT-05**: Arkiv-sidan stödjer bulk-operationer (markera flera, ändra status/prioritet)

### Återkommande ärenden

- [x] **RECUR-01**: Användaren kan skapa en återkommande ärendemall med schema (daglig/veckovis/månatlig/anpassad cron)
- [x] **RECUR-02**: Systemet skapar ärenden automatiskt enligt schemat via bakgrundsschemaläggare
- [x] **RECUR-03**: Användaren kan pausa, redigera och ta bort återkommande scheman
- [x] **RECUR-04**: Användaren kan se historik över skapade ärenden per schema

### Dashboard-köer

- [x] **DASH-01**: Dashboard visar sparade snabbvyer/köer (t.ex. "Väntande", "Utan aktivitet 7+ dagar", "Kritiska")
- [x] **DASH-02**: Användaren kan skapa, redigera och ta bort dashboard-köer
- [x] **DASH-03**: Varje kö visar antal matchande ärenden och kan klickas för att navigera till filtrerad vy

### Reports-rensning

- [x] **RPT-01**: Activity Heatmap och Radial Progress Rings är borttagna från Reports
- [x] **RPT-02**: Tagg-analytics visar alla taggar som används på ärenden (buggfix)
- [x] **RPT-03**: Reports-designen är renare och mer sammanhängande (konsekvent layout, borttagning av överlappande moduler)
- [x] **RPT-04**: ReportsCustomization-funktionen (dölja/visa moduler) tas bort — alla synliga moduler visas alltid

## Future Requirements

### Självbetjäningsportal

- **PORTAL-01**: Beställare kan se status på sina ärenden via e-post-lookup eller token
- **PORTAL-02**: Beställare kan lägga till kommentarer på sina ärenden

### Tidsuppföljning

- **TIME-01**: Användaren kan logga tid på ärenden
- **TIME-02**: Reports visar genomsnittlig handläggningstid per kategori

### Snabbsvar

- **REPLY-01**: Fördefinierade mallsvar som kan infogas i kommentarer med ett klick

## Out of Scope

| Feature | Reason |
|---------|--------|
| E-postintegration (inkommande) | Hög komplexitet, inte prioriterat för v1.1 |
| SLA-regler och eskaleringsautomatik | Överdriven för single-user system |
| Anpassade statusar | Nuvarande 5 statusar täcker arbetsflödet |
| Kanban-vy på Arkiv | Arkiv = tabell, kanban ger inget mervärde på stängda ärenden |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| FILT-01 | Phase 4 | Complete |
| FILT-02 | Phase 4 | Complete |
| FILT-03 | Phase 4 | Complete |
| FILT-04 | Phase 4 | Complete |
| FILT-05 | Phase 4 | Complete |
| RECUR-01 | Phase 5 | Complete |
| RECUR-02 | Phase 5 | Complete |
| RECUR-03 | Phase 5 | Complete |
| RECUR-04 | Phase 5 | Complete |
| DASH-01 | Phase 5 | Complete |
| DASH-02 | Phase 5 | Complete |
| DASH-03 | Phase 5 | Complete |
| RPT-01 | Phase 6 | Complete |
| RPT-02 | Phase 6 | Complete |
| RPT-03 | Phase 6 | Complete |
| RPT-04 | Phase 6 | Complete |

**Coverage:**
- v1.1 requirements: 16 total
- Mapped to phases: 16
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-26*
*Last updated: 2026-03-26 after roadmap creation*

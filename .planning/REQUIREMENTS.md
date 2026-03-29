# Requirements: IT Ticket System

**Defined:** 2026-03-29
**Core Value:** Every ticket gets tracked, resolved, and documented — nothing falls through the cracks and solutions are reusable.

## v1.2 Requirements

Requirements for Knowledge Base Expansion milestone.

### Artikelorganisering

- [x] **ORG-01**: Användaren kan lägga till taggar på KB-artiklar (fristående från ticket-taggar) — 07-01
- [x] **ORG-02**: Användaren kan filtrera artiklar efter tagg i KB-listan — 07-01
- [x] **ORG-03**: Artiklar har draft/publicerad-status — utkast döljs från sök och lista som standard — 07-01

### Innehållskvalitet

- [x] **QUAL-01**: Artiklar har en visningsräknare som ökar vid varje visning — 07-01
- [x] **QUAL-02**: Artiklar har ett `last_reviewed_at`-fält med "Markera som granskad"-knapp
- [x] **QUAL-03**: KB-listan kan filtreras på inaktuella artiklar (ej granskade på N dagar)

### Artikelmallar

- [x] **TMPL-01**: Vid skapande av ny artikel kan användaren välja en mall (t.ex. Solution, How-to)
- [x] **TMPL-02**: Mallen fyller i Tiptap-editorn med fördefinierad struktur

### Innehållsförteckning

- [x] **TOC-01**: Artikeldetaljsidan visar en innehållsförteckning genererad från rubriker i artikeln
- [x] **TOC-02**: Innehållsförteckningen har klickbara ankarlänkar till varje rubrik

### Upptäckbarhet

- [x] **DISC-01**: KB-startsidan visar en "Senast uppdaterade"-sektion (topp 5) — 07-02
- [ ] **DISC-02**: KB-startsidan visar en "Populära artiklar"-sektion baserad på visningsräknare
- [x] **DISC-03**: Artikeldetaljsidan visar "Se även"-korsreferenser till andra artiklar
- [x] **DISC-04**: Användaren kan lägga till/ta bort "Se även"-kopplingar vid redigering

### Genvägar & Arbetsflöde

- [x] **WF-01**: Skriv ut-knapp på artikeldetaljsidan (använder befintlig window.print()-pattern) — 07-02
- [ ] **WF-02**: Tangentbordsgenväg `/` för att fokusera KB-sökfältet
- [ ] **WF-03**: Från ticket-detaljsidan kan användaren skapa en KB-artikel som förifyller titel och typ

## Out of Scope

Explicitly excluded from v1.2.

| Feature | Reason |
|---------|--------|
| Artikelversionshistorik | Noll värde för single-user — author vet vad som ändrades |
| Hierarkiska kategorier | Platta kategorier + taggar täcker behovet, undviker trädkomplexitet |
| Artikelkommentarer | Single-user — diskussion hör hemma i ticket-kommentarer |
| Betyg/ratings | Ingen publik att betygsätta. view_count räcker som signal |
| AI-sammanfattningar | Extern API-dependency, FTS5 snippets ger redan förhandsvisning |
| Mall-CRUD (skapa egna mallar) | Hårdkodade mallar räcker. Kan byggas senare vid behov |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| ORG-01 | Phase 7 | Done |
| ORG-02 | Phase 7 | Done |
| ORG-03 | Phase 7 | Done |
| QUAL-01 | Phase 7 | Done |
| QUAL-02 | Phase 8 | Complete |
| QUAL-03 | Phase 8 | Complete |
| TMPL-01 | Phase 8 | Complete |
| TMPL-02 | Phase 8 | Complete |
| TOC-01 | Phase 8 | Complete |
| TOC-02 | Phase 8 | Complete |
| DISC-01 | Phase 7 | Done |
| DISC-02 | Phase 9 | Pending |
| DISC-03 | Phase 9 | Complete |
| DISC-04 | Phase 9 | Complete |
| WF-01 | Phase 7 | Done |
| WF-02 | Phase 9 | Pending |
| WF-03 | Phase 9 | Pending |

**Coverage:**
- v1.2 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-29*
*Last updated: 2026-03-29 after v1.2 milestone definition*

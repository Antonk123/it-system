# IT Ticket System — Förbättringar & Roadmap

<!--
  TODO.md - Single source of truth för IT Ticket System roadmap & tracking
  Last updated: 2026-03-18
  Latest cleanup: 2026-03-18 - Removed Bulk-operationer (✅ implemented: multi-select, bulk status/tag/category/export)
  Previous cleanup: 2026-03-17 - Removed Password policy, File upload limits, Saved filter presets, Smart folders (all ✅ implemented)
  Previous cleanup: 2026-03-09 - Removed Quick Wins + Security (Rate limit, Token refresh, Helmet) + Critical bugs (FK validation, N+1 export) + Pagination

  Uppdateringsprocess:
  1. Implementerade features → Ta bort från TODO
  2. Fixade buggar → Ta bort från TODO
  3. Versionshistorik → Se docs/archive/VERSION-HISTORY.md
  4. Uppdatera Sammanfattning-tabellen
-->

**Quick deploy command:**
```bash
docker build -f Dockerfile.server -t it-ticketing-backend:latest .
docker build -f Dockerfile.client -t it-ticketing-frontend:latest .
```

> **Note:** Single-user system (personal use). Fokus på produktivitet och inventory-spårning.

---

## ⚡ PRESTANDAPROBLEM

### 1. **Virtualisering för stora listor** (2-3h)
- [ ] Implementera react-window eller react-virtual i TicketList
- [ ] Hantera dynamisk radhöjd för olika ticketstorlekar
- [ ] Estimerad gain: 3-5x snabbare render vid >200 tickets
- **Note:** Pagination är redan implementerad (`PaginationControls.tsx`), men virtualisering ger bättre UX för stora sidor

### 2. **React render-optimering** (1-2h)
- [ ] Wrappa TicketCard med React.memo
- [ ] Wrappa TicketRow med React.memo
- [ ] Använd useCallback för event handlers i listor
- [ ] Estimerad gain: 30-50% färre re-renders

---

## 🔐 SÄKERHETSFÖRBÄTTRINGAR

### 1. **Request-säkerhet**
- [ ] **CSRF-skydd** (prio 2)
  - Implementera CSRF tokens
  - Använd csurf middleware
  - Skydda state-changing endpoints

---


## 🎯 Nästa Features - Hög Prioritet

### 1. **Notifikationer** (1-2h)
- [ ] Daglig/veckovis digest (sammanfattning)
- [ ] Anpassningsbara notifikationsinställningar

---

## 📋 Medel Prioritet

### 3. **Avancerad sökning & filter** (2-3h)
- [ ] Filtrera på flera taggar samtidigt (AND/OR)
- [ ] Filtrera på datumintervall
- [ ] Filtrera på checklist completion

### 4. **Automatisering** (2-3h)
- [ ] Auto-close efter X dagar i "Resolved"
- [ ] Auto-tag baserat på keywords i beskrivning
- [ ] Auto-priority baserat på keywords

### 5. **Checklists förbättringar** (2-3h)
- [ ] Sub-checklists (nested)
- [ ] Checklist-templates (återanvändbara mallar)
- [ ] Progress bar på ärendelistan
- [ ] Deadline per checklist-item

---

## 🔧 Låga Prioritet / Nice-to-Have

### 6. **Asset Management / Inventory** (1-2 veckor)
- [ ] Skapa `assets` tabell (ID, name, type, serial, location, owner, status, warranty)
- [ ] Koppla tickets → assets (för service history tracking)
- [ ] Asset-lista med filter/search
- [ ] QR-kod för quick asset lookup
- [ ] Preventive maintenance scheduler
- [ ] Warranty expiration alerts

**Impact:** Långsiktig inventarie-spårning, högst värde för IT-avdelningar

### 7. **Knowledge Base** ✅ Implementerad
- Artiklar med TipTap-editor (HTML, visuell)
- Egna KB-kategorier (fristående från ticketkategorier)
- Sökning och kategorifilter
- Länka KB-artiklar till tickets (från ticketdetaljvyn)
- **OBS:** Kör migration på servern: `docker exec it-ticketing-backend npx tsx src/db/add-kb-tables.ts`

### 8. **Rapportering & Analytics** (1-2h)
- [ ] Export rapporter till PDF

### 9. **Backup & Maintenance** (2-3h)
- [ ] Automatisk databas-backup (cron)
- [ ] Restore från backup
- [ ] Databas-cleanup (radera gamla stängda ärenden)

### 10. **Integrations (Optional)**
- [ ] Email-in support (skapa ärende från email)
- [ ] Calendar sync
- [ ] REST API dokumentation för externa system

### 11. **UX Polish**
- [ ] **Keyboard Shortcuts Help** (~1h)
  - Settings → Genvägar sektion
  - Visa alla ⌘K shortcuts
  - Toast vid första besöket
- [ ] Accessibility (a11y) förbättringar

---

## ❌ NOT PLANNED (Single-user)

Dessa är inte relevanta för single-user system:
- ❌ Permission-system (multi-user)
- ❌ Audit-logg (multi-user accountability)
- ❌ User workload tracking
- ❌ 2FA (single user)
- ❌ Slack/Teams notifications
- ❌ Customer portal
- ❌ Time billing/invoicing

---

## 📊 Sammanfattning

| Kategori | Återstående | Prioritet | Estimerad tid |
|----------|-------------|-----------|---------------|
| Prestandaproblem | 2 | Medel | 3-5h |
| Säkerhetsförbättringar | 1 | Hög | 1-2h |
| Features (Hög) | 1 | Hög | 1-2h |
| Features (Medel) | 3 | Medel | 6-9h |
| Features (Låg) | 5 | Låg | 8-16h+ |
| **TOTALT** | **12** | - | **~19-32h** |

### 🚀 Rekommenderad prioritering:
1. **CSRF-skydd** (1-2h) - Enda kvarvarande säkerhetspunkt
2. **Avancerad sökning** (2-3h) - Datumfilter, tag AND/OR
3. **Automatisering** (2-3h) - Auto-close, auto-tag

---

## 🎯 Rekommenderad arbetsordning

### Nästa sprint (1-2 veckor)
1. **CSRF-skydd** (1-2h) - Säkerhet

### Sprint 2 (2-3 veckor)
1. Avancerad sökning & filter (datumintervall, tag AND/OR)
2. Automatisering (auto-close, auto-tag)
3. Checklists-förbättringar
4. Keyboard shortcuts help

### Långsiktig backlog (3+ månader)
1. Asset/Inventory Management (högst värde långsiktigt)
2. Knowledge Base
3. Rapportering & Analytics (PDF-export)

---

## Database Changes Guide

Varje gång vi lägger till features med databas-ändringar:

1. **Uppdatera schema:**
   ```bash
   # Redigera server/src/db/schema.sql
   ```

2. **Reinitiera databasen (⚠️ raderar all data):**
   ```bash
   docker exec it-ticketing-backend npm run init-db
   ```

3. **Eller använd migration scripts (bevarar data):**
   ```bash
   # Lista alla template-fält
   docker exec it-ticketing-backend npm run list-fields

   # Uppdatera fältetikett
   docker exec it-ticketing-backend npm run update-field-label <field_name> <new_label>

   # Lägg till fält för "Ny användare" mall
   docker exec it-ticketing-backend npm run add-new-user-fields

   # Uppdatera Prefabmästarna-fält (CRM → Business Central)
   docker exec it-ticketing-backend npm run update-prefab

   # Ta bort Budget-fält
   docker exec it-ticketing-backend npm run remove-budget

   # Migrera ticket_tags tabell (lägg till id-kolumn)
   docker exec it-ticketing-backend npm run migrate-ticket-tags

   # Performance indexes
   docker exec it-ticketing-backend npx tsx src/db/add-performance-indexes.ts

   # Refresh tokens table
   docker exec it-ticketing-backend npx tsx src/db/add-refresh-tokens.ts

   # Cleanup refresh tokens (kan köras via cron)
   docker exec it-ticketing-backend npx tsx src/db/cleanup-refresh-tokens.ts
   ```

4. **Lokal development:**
   ```bash
   npm run dev  # Frontend
   cd server && npm run dev  # Backend (startar på :3002)
   ```

---

## Development Notes

**Build Docker images:**
```bash
docker build -f Dockerfile.server -t it-ticketing-backend:latest .
docker build -f Dockerfile.client -t it-ticketing-frontend:latest .
Uppdatera stack via portainer
```

**Initialisera databas:**
```bash
docker exec it-ticketing-backend npm run init-db
```

**Starta dev-miljö (hot-reload, ~1-3s per ändring):**
```bash
docker compose -f docker-compose.dev.portainer.yml up -d
# Frontend: http://10.38.195.180:5174 (Vite HMR)
# Backend:  http://10.38.195.180:3003 (tsx watch)
```

---

## Asset Tracking Vision

När vi implementerar assets kan system se ut såhär:

```
Assets:
├── ID, Name, Type
├── Serial Number (unik)
├── Location, Owner
├── Purchase Date, Warranty
├── Status (Active, Inactive, Retired)
└── Notes

Integration med Tickets:
├── Koppla ticket → asset
├── Se all service history per asset
├── Preventive maintenance scheduler
└── Warranty alerts
```

---

**Senast uppdaterad:** 2026-03-18
**Latest cleanup:** Removed Bulk-operationer (✅ implemented)
**Previous cleanup:** Removed multi-user features (assignee, SLA, auto-assign) + notification triggers + completed items
**Version history:** See `docs/archive/VERSION-HISTORY.md`

# IT Ticket System — Förbättringar & Roadmap

> **Note:** Single-user system (personal use). Fokus på produktivitet och inventory-spårning.

## ✅ Avklarade Features

### Tags/Labels System ✅
- [x] Databastabeller (tags, ticket_tags)
- [x] Backend API för tag CRUD
- [x] Frontend TagSelector component
- [x] Frontend TagBadges display
- [x] Integrera i TicketTable
- [x] Integrera i TicketDetail
- [x] Fördefinierade färger (10 val)

### Smart Search Suggestions ✅
- [x] Quick Actions (Create ticket, Settings)
- [x] Recent tickets tracking via localStorage
- [x] Popular tags (top 5 by usage)
- [x] Popular categories (top 5 by usage)
- [x] Hide suggestions when typing
- [x] Track view history in TicketDetail

### Kanban View ✅
- [x] Drag & drop tickets mellan status kolumner (open, in-progress, waiting, resolved, closed)
- [x] Snabb status-update via drag
- [x] View toggle (Table ↔ Kanban)
- [x] Spara view preference i localStorage

### Enhanced Full-Text Search ✅
- [x] Sök i notes, solution, comments, category, requester name, tags
- [x] Backend: SQL WHERE clause med LEFT JOINs
- [x] Hantera duplicates med DISTINCT
- [x] Table-prefixed field names för ORDER BY

---

## 🎯 Nästa Features - Höga Prioritet

### 2. **Duplicate Detection**
- [ ] Similaritets-algoritm (Levenshtein distance)
- [ ] Varna när man skapar liknande ticket
- [ ] Visa matchande tickets med likhetsscore
- [ ] Möjlighet att länka till existerade ticket istället

---

## 📋 Medel Prioritet

### 3. **Asset/Inventory Management**
- [ ] `assets` tabell (datorer, printers, etc)
- [ ] Asset-formulär (namn, typ, serial, location, owner, warranty)
- [ ] Asset-lista med sökning/filtrering
- [ ] Koppla tickets till assets
- [ ] Asset-historik (alla associerade tickets)
- [ ] QR-kod generator för asset-lookup
- [ ] Depreciation tracking

### 4. **Användarbarhet Förbättringar**
- [ ] Keyboard shortcuts (cmd+K för search, cmd+N för ny ticket, etc)
- [ ] Bulk-operations (select många, ändra status/taggar på flera)
- [ ] Spara filter som favoriter (favorites)
- [ ] Dashboard widgets (open today, overdue, recent, stats)

### 5. **Avancerad Rapportering**
- [ ] SLA-tracking (target vs actual resolution time)
- [ ] Ticket trends (per vecka, kategori, tag)
- [ ] Time tracking per ticket
- [ ] Mest vanliga issue-types
- [ ] CSV/PDF export

---

## 🔧 Låga Prioritet / Nice-to-Have

### 6. **Data & Backup**
- [ ] Automatic scheduled backups
- [ ] Data export (JSON/CSV)
- [ ] Restore från backup

### 7. **Integrations (Optional)**
- [ ] Email-in support (skapa ticket från email)
- [ ] Calendar sync
- [ ] API för externa system

### 8. **UX Polish**
- [ ] Dark mode toggle
- [ ] Mobile responsive improvements
- [ ] Accessibility (a11y) improvements

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

## Database Changes Guide

Varje gång vi lägger till features med databas-ändringar:

1. **Uppdatera schema:**
   ```bash
   # Redigera server/src/db/schema.sql
   ```

2. **Reinitiera databasen:**
   ```bash
   docker exec it-ticketing-backend npm run init-db
   ```

3. **Eller lokal development:**
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
docker compose -f docker-compose.local.yml up -d
```

**Initialisera databas:**
```bash
docker exec it-ticketing-backend npm run init-db
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

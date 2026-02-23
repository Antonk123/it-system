# IT Ticket System — Förbättringar & Roadmap

docker build -f Dockerfile.server -t it-ticketing-backend:latest . && \
docker build -f Dockerfile.client -t it-ticketing-frontend:latest . && \
docker compose -f docker-compose.local.yml up -d --force-recreate

Används för att pusha ändringar till produktion

> **Note:** Single-user system (personal use). Fokus på produktivitet och inventory-spårning.

## ✅ Avklarade Features

### Tags/Labels System ✅
- [x] Databastabeller (tags, ticket_tags)
- [x] Backend API för tag CRUD (/api/tags routes)
- [x] Frontend TagSelector component
- [x] Frontend TagBadges display
- [x] Integrera i TicketTable
- [x] Integrera i TicketDetail
- [x] Integrera i Kanban-kort
- [x] Fördefinierade färger (10 val)
- [x] Tags inkluderade i ticket-listans datamappning (useTickets hook)
- [x] Tag-hantering under /settings (skapa, redigera, ta bort, färgväljare)

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
- [x] Dark theme kort-design (matchar systemets mörka tema)
- [x] Visa prioritet med ikon och färg på kort
- [x] Visa taggar på kort
- [x] Visa kategori på kort
- [x] Klickbara kort (klick → ärendedetalj, drag → flytta status)

### Enhanced Full-Text Search ✅
- [x] Sök i notes, solution, comments, category, requester name, tags
- [x] Backend: SQL WHERE clause med LEFT JOINs
- [x] Hantera duplicates med DISTINCT
- [x] Table-prefixed field names för ORDER BY

---

## ⚡ Quick Wins (Snabba förbättringar)

### 1. **Filtrering & Sökning**
- [ ] Filtrera ärenden på taggar i ticket-listan
- [ ] Datumintervall-filter (skapat/löst mellan datum)
- [ ] Spara filterkombon som favoriter/vyer
- [ ] Sökhistorik i sökfältet

### 2. **Favoriter & Snabbåtkomst**
- [ ] Stjärnmärk/flagga viktiga ärenden
- [ ] Favoriter-sektion på Dashboard
- [x] ⌘K snabbsökning & snabbåtgärder (Nytt ärende, Inställningar, senaste ärenden)
- [ ] ⌘N för nytt ärende direkt (utan att öppna ⌘K)
- [ ] ⌘1-5 för snabb statusbyte på öppet ärende

### 3. **Dashboard Förbättringar**
- [ ] "Dagens aktivitet" widget
- [ ] "Gamla/förfallna ärenden" widget (öppna > 7 dagar)
- [ ] Genomsnittlig lösnings-tid
- [ ] Dashboard-snabbknappar: visa öppna, visa kritiska (skapa ärende täcks av ⌘K)
- [ ] Trendgraf (ärenden per vecka, senaste 8 veckor)

---

## 🎯 Nästa Features - Höga Prioritet

### 4. **Duplicate Detection**
- [ ] Similaritets-algoritm (Levenshtein distance)
- [ ] Varna när man skapar liknande ärende
- [ ] Visa matchande ärenden med likhetsscore
- [ ] Möjlighet att länka till existerande ärende istället

### 5. **Bulk-operationer**
- [ ] Checkbox-selektion i tabellvy
- [ ] Markera flera → ändra status
- [ ] Markera flera → tilldela taggar
- [ ] Markera flera → ändra kategori/prioritet
- [ ] Markera flera → radera

### 6. **Email-notifikationer (utökade)**
- [ ] Email vid statusändring (inte bara skapande/stängning)
- [ ] Email-digest (daglig/veckovis sammanfattning av öppna ärenden)
- [ ] Konfigurera vilka händelser som triggar email i Settings

---

## 📋 Medel Prioritet

### 7. **Asset/Inventory Management**
- [ ] `assets` tabell (datorer, printers, etc)
- [ ] Asset-formulär (namn, typ, serial, location, owner, warranty)
- [ ] Asset-lista med sökning/filtrering
- [ ] Koppla ärenden till assets
- [ ] Asset-historik (alla associerade ärenden)
- [ ] QR-kod generator för asset-lookup
- [ ] Warranty-alerts (email vid utgående garanti)

### 8. **Tidshantering & SLA**
- [ ] Tidsuppskattning per ärende (estimat vs faktisk)
- [ ] SLA-mål per kategori/prioritet
- [ ] Visuell "försenad"-indikator på ärenden som överskrider SLA
- [ ] Rapporter: genomsnittlig lösningstid per kategori/prioritet

### 9. **Avancerad Rapportering**
- [ ] Ticket trends (per vecka, kategori, tag)
- [ ] Tag-baserad rapportering
- [ ] Kategori-specifika metrics
- [ ] CSV/PDF export av rapporter
- [ ] Mest vanliga issue-types

---

## 🔧 Låga Prioritet / Nice-to-Have

### 10. **Återkommande Ärenden**
- [ ] Skapa mallar för återkommande uppgifter
- [ ] Schema: dagligen, veckovis, månadsvis
- [ ] Auto-skapa ärende vid schemalagt datum
- [ ] Användbart för underhåll, backup-kontroller, etc.

### 11. **Knowledge Base**
- [ ] Skapa KB-artiklar från lösta ärenden (solution → artikel)
- [ ] Sökbar kunskapsbas
- [ ] Länka KB-artiklar till nya ärenden
- [ ] Markdown-stöd (redan finns)

### 12. **Data & Backup**
- [ ] Automatiska schemalagda backups
- [ ] Data export (JSON/CSV)
- [ ] Restore från backup
- [ ] Databas-cleanup (radera gamla stängda ärenden)

### 13. **Integrations (Optional)**
- [ ] Email-in support (skapa ärende från email)
- [ ] Calendar sync
- [ ] REST API dokumentation för externa system

### 14. **UX Polish**
- [ ] Light/dark mode toggle (system stöder teman redan)
- [ ] Mobile responsive förbättringar
- [ ] Accessibility (a11y) förbättringar
- [ ] PWA-stöd (offline-läge, installera som app)

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

**Starta dev-miljö (hot-reload, ~1-3s per ändring):**
```bash
docker compose -f docker-compose.dev.portainer.yml up -d
# Frontend: http://10.10.10.18:5174 (Vite HMR)
# Backend:  http://10.10.10.18:3003 (tsx watch)
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

# IT Ticket System — Backlog

> Single-user system (personal use). Fokus på produktivitet och inventory-spårning.
> Deploy-instruktioner, tech stack och dev-miljö finns i `CLAUDE.md`.

---

## Prestanda

### Virtualisering för stora listor
- [ ] Implementera react-window eller react-virtual i TicketList
- [ ] Hantera dynamisk radhöjd för olika ticketstorlekar
- **Note:** Pagination finns redan, men virtualisering ger bättre UX vid >200 tickets

### React render-optimering
- [ ] Wrappa TicketCard/TicketRow med React.memo
- [ ] Använd useCallback för event handlers i listor

---

## Säkerhet

### CSRF-skydd
- [ ] Implementera CSRF tokens med csurf middleware
- [ ] Skydda state-changing endpoints

---

## Features

### Notifikationer
- [ ] Daglig/veckovis digest (sammanfattning)
- [ ] Anpassningsbara notifikationsinställningar

### Checklists-förbättringar
- [ ] Sub-checklists (nested)
- [ ] Checklist-templates (återanvändbara mallar)
- [ ] Progress bar på ärendelistan
- [ ] Deadline per checklist-item

### Rapportering
- [ ] Export rapporter till PDF

### UX Polish
- [ ] Keyboard Shortcuts Help (Settings → Genvägar)
- [ ] Accessibility (a11y) förbättringar

---

## Långsiktig backlog

### Asset Management / Inventory
- [ ] Skapa `assets` tabell (ID, name, type, serial, location, owner, status, warranty)
- [ ] Koppla tickets → assets (service history tracking)
- [ ] Asset-lista med filter/search
- [ ] QR-kod för quick asset lookup
- [ ] Preventive maintenance scheduler
- [ ] Warranty expiration alerts

### Backup & Maintenance
- [ ] Automatisk databas-backup (cron)
- [ ] Restore från backup
- [ ] Databas-cleanup (radera gamla stängda ärenden)

### Integrations
- [ ] Email-in support (skapa ärende från email)
- [ ] REST API dokumentation för externa system

---

## Ej planerat (single-user)

- Permission-system, audit-logg, user workload tracking
- 2FA, Slack/Teams notifications
- Customer portal, time billing/invoicing

---

*Senast uppdaterad: 2026-03-29*
*Cleanup: Tog bort implementerade features (KB, filter, automatisering, bulk ops). Flyttade deploy/dev-info till CLAUDE.md.*

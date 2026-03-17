## 📦 VERSIONSHISTORIK
> **Notis:** Versionshistoriken är sorterad från äldsta till nyaste (bottom = senaste versionen)

### v1.2.0 (2026-02-14) - Säkerhets- och stabilitetsfixar
**Buggfixar:**
- ✅ Tyst felhantering i useTickets.ts
- ✅ Felhantering för fil-/checklistuppladdningar
- ✅ Felaktig tokenhantering i API

**Säkerhetsförbättringar:**
- ✅ CORS-skydd (endast specifika origins)
- ✅ SQL-injektionsskydd (whitelist för UPDATE-fält)
- ✅ Filuppladdning-validering (whitelist för MIME-typer)
- ✅ JWT endast i Authorization header (borttaget från URL)
- ✅ Obligatorisk JWT_SECRET
- ✅ Filer serveras som `attachment`

### v1.2.1 (2026-02-15) - E-postnotifikationer & CORS
**Nya funktioner:**
- ✅ E-postnotifikationer vid ärendeskapande och stängning
- ✅ Konfigurerbar SMTP-setup via miljövariabler
- ✅ Support för Gmail, Outlook, custom SMTP

**Säkerhetsförbättringar:**
- ✅ CORS-konfiguration med environment variables
- ✅ Stöd för flera origins

### v1.3.0 (2026-02-16) - Ärendemallar & UI-förbättringar
**Nya funktioner:**
- ✅ **Ärendemallar (Ticket Templates)**
  - Fullständig mallredigerare med alla fält
  - 3 fördefinierade mallar (Lösenordsåterställning, Ny användare, Hårdvarubeställning)
  - Mallhantering i Settings (skapa, redigera, radera, omordna)
  - "Skapa från mall"-knapp i ticketformulär
  - Position-baserad sortering

**UI-förbättringar:**
- ✅ Förbättrad kontrast för checkboxar i mörkt läge
  - Tjockare ram (border-2)
  - Vit check-mark med fetare streck

**Tekniska detaljer:**
- Nya tabeller: `ticket_templates`, `template_checklists`
- Nya endpoints: `/api/templates` (GET, POST, PUT, DELETE, reorder)
- Ny komponent: `TemplateEditorModal`
- Ny hook: `useTemplates`

### v1.4.0 (2026-02-17) - Dynamiska fält i autentiserat formulär
**Nya funktioner:**
- ✅ **Dynamiska template-fält i TicketForm (inloggad vy)**
  - Samma DynamicFieldsForm-komponent som i PublicTicketForm
  - Välj mall med fält → beskrivningsfältet ersätts av dynamiska fält
  - Fältvärden sparas strukturerat i `ticket_field_values` och som formaterad description

**Tekniska detaljer:**
- Backend: `GET /api/templates` returnerar fält per mall
- Backend: `POST /api/tickets` accepterar `customFields`
- Frontend: `Template`-interface utökat med `fields?: TemplateFieldRow[]`

### v1.4.1 (2026-02-17) - Redigering av mallärenden & fältdatafixar
**Buggfixar:**
- ✅ **Dubbla "Fältdata"-sektioner** fixad (backend är nu auktoritativ)
- ✅ **Redigering av mallärenden** visar nu korrekt dynamiska fält
  - `template_id`-kolumn tillagd via migration
  - `GET /api/tickets/:id` returnerar `field_values`
- ✅ Checkbox-fältvärden: "true"/"false" → "Ja"/"Nej"
- ✅ MarkdownTextarea för textarea-fält

### v1.4.2 (2026-02-17) - Formatfix publikt formulär
**Buggfixar:**
- ✅ Fältdata visades på en rad — fixad med `  \\n` (markdown hard line break)

### v1.4.3 (2026-02-17) - template_id i publika ärenden
**Buggfixar:**
- ✅ **Ärenden skapade via PublicTicketForm sparar nu `template_id`**
  - Redigeringsläget visar korrekt dynamiska fält

**Tekniska detaljer:**
- `PublicTicketForm.tsx`: skickar `template_id: selectedTemplate?.id`
- `server/src/routes/public.ts`: lagrar `template_id` i INSERT

### v1.4.4 (2026-02-17) - Hover-effekter i PublicTicketForm
**Förbättringar:**
- ✅ Kategori- och prioritets-SelectItems har samma `data-[highlighted]`-hover-styling

### v1.4.5 (2026-02-17) - Strukturerad fältvisning & markdown i ärendedetalj
**Nya funktioner:**
- ✅ **Strukturerad visning av dynamiska fält i TicketDetail**
  - Varje fält visas separat (etikett + värde) istället för sammansatt textsträng
  - Varje fältvärde renderas via `MarkdownRenderer`
- ✅ **Markdown i `notes`-fältet** — `TicketDetail.tsx` och `SharedTicket.tsx` renderar anteckningar via `MarkdownRenderer`

**Tekniska detaljer:**
- `TicketDetail.tsx`: nytt `ticketFieldValues`-state, hämtar `field_values`

### v1.5.0 (2026-02-17) - Revisionsspår / Aktivitetslogg
**Nya funktioner:**
- ✅ **Aktivitetslogg per ärende** — visar vem som gjort vad och när
  - Statusbyten, prioritetsändringar, kategoribyten
  - Titel uppdaterad, anteckningar uppdaterade, lösning tillagd/uppdaterad
  - "Ärende skapat" loggas vid skapande
- ✅ Visas i ärendedetaljvyn (efter kommentarsektionen)

**Tekniska detaljer:**
- Ny tabell: `ticket_history` (id, ticket_id, user_id, field_name, old_value, new_value, changed_at)
- Ny endpoint: `GET /api/tickets/:id/history`
- `PUT /api/tickets/:id` loggar ändringar av: status, priority, category_id, title, notes, solution
- Ny hook: `useTicketHistory.ts`, ny komponent: `TicketActivity.tsx`

### v1.5.1 (2026-02-17) - Markdown i e-postnotifikationer & XSS-fix
**Buggfixar / Säkerhet:**
- ✅ **Markdown renderas korrekt i e-postnotifikationer** — `**Fältnamn**`-syntax konverteras till `<strong>`
- ✅ **XSS-skydd i e-postmallar** — all användarinmatning HTML-escapas

**Tekniska detaljer:**
- `server/src/lib/email.ts`: ny `escapeHtml()` och `markdownToEmailHtml()`

### v1.5.2 (2026-02-19) - Rollhantering i Inställningar
**Nya funktioner:**
- ✅ **Rollval vid skapande av ny användare** — dropdown (Användare/Admin) i inbjudningsformuläret
- ✅ **Ändra roll på befintliga användare** — "Gör admin" / "Ta bort admin"-knapp per användare

**Tekniska detaljer:**
- `src/pages/Settings.tsx`: `inviteRole`-state, `Select`-dropdown, rollväxlingsknapp

### v1.5.3 (2026-02-19) - Bilagafix, kommentarer i aktivitetslogg & kontaktpaginering
**Buggfixar:**
- ✅ **Bilagor öppnas/laddas ned korrekt** — `secureFileAccess.ts` använde fel localStorage-nyckel (`token` → `auth_token`)

**Nya funktioner:**
- ✅ **Interna kommentarer syns i aktivitetslogg** — kommentarer blandas in kronologiskt med övrig aktivitet
- ✅ **Paginering på kontaktlista** — `GET /contacts?page=&limit=&search=` returnerar nu `{ contacts, pagination }`

**Tekniska detaljer:**
- `src/lib/secureFileAccess.ts`: `auth_token` + `/api` relativ URL
- `src/components/TicketActivity.tsx`: accepterar `comments?: Comment[]`
- `server/src/routes/contacts.ts`: ny paginering i `GET /`

### v1.5.4 (2026-02-19) - Taggar/Etiketter-system
**Nya funktioner:**
- ✅ **Taggar per ärende** — flervalsetiketter med valfri färg (12 förinställda färger)
- ✅ **Inline-skapande** — skriv ett nytt taggnamn direkt i taggväljaren på ärendet → skapas och tilldelas direkt
- ✅ **Tagghantering i Inställningar** — skapa, redigera (namn + färg) och ta bort taggar med bekräftelsedialog
- ✅ **Synliga taggar på ärendelistan** — färgade badge-chips visas direkt på varje ärenderad
- ✅ **Filtrera på tagg** — ny tagg-dropdown i filterfältet på ärendelistan

**Tekniska detaljer:**
- Nya tabeller: `tags` och `ticket_tags` (många-till-många, CASCADE)
- Nya routes: `server/src/routes/tags.ts` (CRUD för taggar + GET/PUT per ärende)
- `server/src/routes/tickets.ts`: `?tag=tagId` filter + `tags[]` i GET /:id
- `src/components/TicketTagSelector.tsx`: Popover + Command, inline-skapande
- `src/pages/Settings.tsx`: "Taggar"-sektion med färgval
- `src/components/TicketTable.tsx`: taggar renderas som badges

### v1.5.5 (2026-02-19) - Buggfixar: föräldralösa referenser, tagg-filter i Arkiv & global sökning
**Buggfixar:**
- ✅ **Föräldralösa referenser vid radering av kategorier** — backend kontrollerar nu om kategorin används av ärenden (via `category_id`) och blockerar radering med felmeddelande
- ✅ **Föräldralösa referenser vid radering av kontakter** — backend blockerar radering om kontakten har aktiva (ej stängda/lösta) ärenden
- ✅ **Success-toast vid kategoriraderade** — `handleDeleteCategory` är nu async och visar success-toast enbart om raderingen lyckades
- ✅ **"Sök överallt" hittade inte arkiverade ärenden** — `Layout` hämtar nu tickets med `includeArchived: true`

**Nya funktioner:**
- ✅ **Tagg-filter på Arkiv-sidan** — samma tagg-dropdown som på Alla Ärenden, inkluderas även i CSV-export

**Tekniska detaljer:**
- `server/src/routes/categories.ts`: `SELECT COUNT(*) FROM tickets WHERE category_id = ?` innan DELETE, 409 vid träff
- `server/src/routes/contacts.ts`: `SELECT COUNT(*) FROM tickets WHERE requester_id = ? AND status NOT IN ('closed', 'resolved')` innan DELETE
- `src/pages/Archive.tsx`: `tagFilter` URL-param + tagg-Select
- `src/hooks/useTickets.ts`: ny `includeArchived?: boolean` i options
- `src/components/Layout.tsx`: `useTickets({ page: 1, limit: 200, includeArchived: true })`

### v1.3.1 (2026-02-24) - Tag-filtrering & Buggfixar
- **Nya funktioner:**
  - Tag-filtrering (multi-select, OR-logik)
  - Klickbara tag-badges - klicka på tagg → visa alla ärenden med den taggen
  - TagMultiSelect & TagFilter komponenter
  - Tag-sortering - sortera ärenden alfabetiskt efter taggar
  - URL-baserad tagg-filtrering - deep links med ?tags=uuid1,uuid2
- **Buggfixar:**
  - File Authentication Fix (localStorage token key 'auth_token')
  - Double API Path Fix (dubbel /api i URL-konstruktion)
  - ticket_tags Migration (id-kolumn tillagd i ticket_tags tabell)
- **Dokumentation:**
  - Documentation Consolidation (CLAUDE.md merge)
- **Backend:** npm-script `migrate-ticket-tags`
- **Frontend:** TagMultiSelect.tsx, TagFilter.tsx
- **Database:** ticket_tags tabell nu med id PRIMARY KEY

### v1.3.2 (2026-02-26) - Rapportsidans prestandaförbättringar & förbättrad visualisering
- **Prestandaförbättringar:**
  - 15-20x snabbare beräkning av requester analytics (single-pass algoritm, O(M+N) istället för O(3N×M))
  - Begränsat visning till top 15 requesters för bättre prestanda
  - Reducerade animationstider från 1200ms till 800ms
  - Togs bort nested animations som orsakade FPS-drops
- **Nya funktioner:**
  - Förbättrad "Requester Analytics" sektion med:
    - 4 KPI-sammanfattningskort (Total Requesters, Avg per Requester, Workload Balance, Avg Completion)
    - Stacked bar chart med 5 status-segment och gradients
    - Omfattande metrics per requester (12+ datapunkter)
    - Rich tooltips med completion rate, avg resolution time, aging tickets, top categories
  - Förbättrade "Ärenden per status" och "Ärenden per prioritet" sektioner:
    - Gradient fills för alla segment/bars
    - Staggered fade-in animations
    - Glassmorphic tooltip styling
    - Konsekventa typografi och design
- **Buggfixar:**
  - Fixed Legend formatting (visar nu svenska etiketter istället för "statusBreakdown.closed" etc.)
- **Borttagna funktioner:**
  - Tog bort "Ärende för Alla användare" tabell-sektion (orsakade prestandaproblem)
- **Tekniska detaljer:**
  - Ny RequesterAnalytics TypeScript interface med comprehensive metrics
  - Optimerad data calculation med ticket grouping och inline metric beräkning
  - Refactored useMemo dependencies för bättre performance

### v1.3.3 (2026-03-04) - Settings-sidens prestandaförbättringar & Template-editor-fix
- **Prestandaförbättringar:**
  - React.memo för CategoryItem och TemplateItem (förhindrar onödiga re-renders)
  - useCallback för alla event handlers (10+ handlers)
  - Collapsible sections (80% mindre initial rendering, endast Appearance öppen som standard)
  - Reducerad DOM-komplexitet från 5 expanderade sektioner → 1 sektion
  - Memoization förhindrar att list items re-renderas vid scroll
- **Buggfixar:**
  - Template-editor auto-fill fix (setTimeout-approach för state-synkronisering)
  - Dynamiska fält visas nu korrekt vid redigering av templates
- **UI-förbättringar:**
  - Tema-aware hover-färg på collapsible headers (hover:bg-primary/10)
  - Hover-effekter matchar nu valt tema (Arctic/Cyberpunk/Terminal/etc)
  - Klickbara section headers med +/− indikatorer
- **Tekniska detaljer:**
  - Settings.tsx: CategoryItem och TemplateItem med React.memo
  - Settings.tsx: Collapsible sections med expand/collapse state
  - TemplateEditorModal.tsx: setTimeout(0) för state-synkronisering

### v1.3.4 (2026-03-04) - PWA Support (Progressive Web App)
- **Nya funktioner:**
  - ✅ **PWA-stöd** — installera systemet som app på mobil/desktop
  - ✅ **Offline-sida** — informativ sida när internetanslutning saknas (Offline.tsx)
  - ✅ **Service Worker** — automatisk uppdatering och caching via Workbox
  - ✅ **API-caching** — NetworkFirst-strategi för API-anrop med 24h cache
  - ✅ **App-manifest** — konfiguration för installationsupplevelse
  - ✅ **App-ikoner** — 192x192 och 512x512 maskable icons
- **Tekniska detaljer:**
  - `vite.config.ts`: VitePWA plugin med Workbox konfiguration
  - `public/manifest.json`: App-manifest (standalone display, sv språk)
  - `public/icons/`: icon-192x192.png, icon-512x512.png
  - `src/pages/Offline.tsx`: Offline fallback-sida
  - `index.html`: manifest-länk
  - Workbox caching: `**/*.{js,css,html,ico,png,svg,woff2}` + API runtime caching

### v1.3.1 (2026-02-24) - Tag-filtrering & Buggfixar
- **Nya funktioner:**
  - Tag-filtrering (multi-select, OR-logik)
  - Klickbara tag-badges - klicka på tagg → visa alla ärenden med den taggen
  - TagMultiSelect & TagFilter komponenter
  - Tag-sortering - sortera ärenden alfabetiskt efter taggar
  - URL-baserad tagg-filtrering - deep links med ?tags=uuid1,uuid2
- **Buggfixar:**
  - File Authentication Fix (localStorage token key 'auth_token')
  - Double API Path Fix (dubbel /api i URL-konstruktion)
  - ticket_tags Migration (id-kolumn tillagd i ticket_tags tabell)
- **Dokumentation:**
  - Documentation Consolidation (CLAUDE.md merge)
- **Backend:** npm-script `migrate-ticket-tags`
- **Frontend:** TagMultiSelect.tsx, TagFilter.tsx
- **Database:** ticket_tags tabell nu med id PRIMARY KEY

### v1.5.5 (2026-02-19) - Buggfixar: föräldralösa referenser, tagg-filter i Arkiv & global sökning
**Buggfixar:**
- ✅ **Föräldralösa referenser vid radering av kategorier** — backend kontrollerar nu om kategorin används av ärenden (via `category_id`) och blockerar radering med felmeddelande
- ✅ **Föräldralösa referenser vid radering av kontakter** — backend blockerar radering om kontakten har aktiva (ej stängda/lösta) ärenden
- ✅ **Success-toast vid kategoriraderade** — `handleDeleteCategory` är nu async och visar success-toast enbart om raderingen lyckades
- ✅ **"Sök överallt" hittade inte arkiverade ärenden** — `Layout` hämtar nu tickets med `includeArchived: true`

**Nya funktioner:**
- ✅ **Tagg-filter på Arkiv-sidan** — samma tagg-dropdown som på Alla Ärenden, inkluderas även i CSV-export

**Tekniska detaljer:**
- `server/src/routes/categories.ts`: `SELECT COUNT(*) FROM tickets WHERE category_id = ?` innan DELETE, 409 vid träff
- `server/src/routes/contacts.ts`: `SELECT COUNT(*) FROM tickets WHERE requester_id = ? AND status NOT IN ('closed', 'resolved')` innan DELETE
- `src/pages/Archive.tsx`: `tagFilter` URL-param + tagg-Select
- `src/hooks/useTickets.ts`: ny `includeArchived?: boolean` i options
- `src/components/Layout.tsx`: `useTickets({ page: 1, limit: 200, includeArchived: true })`

### v1.5.4 (2026-02-19) - Taggar/Etiketter-system
**Nya funktioner:**
- ✅ **Taggar per ärende** — flervalsetiketter med valfri färg (12 förinställda färger)
- ✅ **Inline-skapande** — skriv ett nytt taggnamn direkt i taggväljaren på ärendet → skapas och tilldelas direkt
- ✅ **Tagghantering i Inställningar** — skapa, redigera (namn + färg) och ta bort taggar med bekräftelsedialog
- ✅ **Synliga taggar på ärendelistan** — färgade badge-chips visas direkt på varje ärenderad
- ✅ **Filtrera på tagg** — ny tagg-dropdown i filterfältet på ärendelistan

**Tekniska detaljer:**
- Nya tabeller: `tags` och `ticket_tags` (många-till-många, CASCADE)
- Nya routes: `server/src/routes/tags.ts` (CRUD för taggar + GET/PUT per ärende)
- `server/src/routes/tickets.ts`: `?tag=tagId` filter + `tags[]` i GET /:id
- `src/components/TicketTagSelector.tsx`: Popover + Command, inline-skapande
- `src/pages/Settings.tsx`: "Taggar"-sektion med färgval
- `src/components/TicketTable.tsx`: taggar renderas som badges

### v1.5.3 (2026-02-19) - Bilagafix, kommentarer i aktivitetslogg & kontaktpaginering
**Buggfixar:**
- ✅ **Bilagor öppnas/laddas ned korrekt** — `secureFileAccess.ts` använde fel localStorage-nyckel (`token` → `auth_token`)

**Nya funktioner:**
- ✅ **Interna kommentarer syns i aktivitetslogg** — kommentarer blandas in kronologiskt med övrig aktivitet
- ✅ **Paginering på kontaktlista** — `GET /contacts?page=&limit=&search=` returnerar nu `{ contacts, pagination }`

**Tekniska detaljer:**
- `src/lib/secureFileAccess.ts`: `auth_token` + `/api` relativ URL
- `src/components/TicketActivity.tsx`: accepterar `comments?: Comment[]`
- `server/src/routes/contacts.ts`: ny paginering i `GET /`

### v1.5.2 (2026-02-19) - Rollhantering i Inställningar
**Nya funktioner:**
- ✅ **Rollval vid skapande av ny användare** — dropdown (Användare/Admin) i inbjudningsformuläret
- ✅ **Ändra roll på befintliga användare** — "Gör admin" / "Ta bort admin"-knapp per användare

**Tekniska detaljer:**
- `src/pages/Settings.tsx`: `inviteRole`-state, `Select`-dropdown, rollväxlingsknapp

### v1.5.1 (2026-02-17) - Markdown i e-postnotifikationer & XSS-fix
**Buggfixar / Säkerhet:**
- ✅ **Markdown renderas korrekt i e-postnotifikationer** — `**Fältnamn**`-syntax konverteras till `<strong>`
- ✅ **XSS-skydd i e-postmallar** — all användarinmatning HTML-escapas

**Tekniska detaljer:**
- `server/src/lib/email.ts`: ny `escapeHtml()` och `markdownToEmailHtml()`

### v1.5.0 (2026-02-17) - Revisionsspår / Aktivitetslogg
**Nya funktioner:**
- ✅ **Aktivitetslogg per ärende** — visar vem som gjort vad och när
  - Statusbyten, prioritetsändringar, kategoribyten
  - Titel uppdaterad, anteckningar uppdaterade, lösning tillagd/uppdaterad
  - "Ärende skapat" loggas vid skapande
- ✅ Visas i ärendedetaljvyn (efter kommentarsektionen)

**Tekniska detaljer:**
- Ny tabell: `ticket_history` (id, ticket_id, user_id, field_name, old_value, new_value, changed_at)
- Ny endpoint: `GET /api/tickets/:id/history`
- `PUT /api/tickets/:id` loggar ändringar av: status, priority, category_id, title, notes, solution
- Ny hook: `useTicketHistory.ts`, ny komponent: `TicketActivity.tsx`

### v1.4.5 (2026-02-17) - Strukturerad fältvisning & markdown i ärendedetalj
**Nya funktioner:**
- ✅ **Strukturerad visning av dynamiska fält i TicketDetail**
  - Varje fält visas separat (etikett + värde) istället för sammansatt textsträng
  - Varje fältvärde renderas via `MarkdownRenderer`
- ✅ **Markdown i `notes`-fältet** — `TicketDetail.tsx` och `SharedTicket.tsx` renderar anteckningar via `MarkdownRenderer`

**Tekniska detaljer:**
- `TicketDetail.tsx`: nytt `ticketFieldValues`-state, hämtar `field_values`

### v1.4.4 (2026-02-17) - Hover-effekter i PublicTicketForm
**Förbättringar:**
- ✅ Kategori- och prioritets-SelectItems har samma `data-[highlighted]`-hover-styling

### v1.4.3 (2026-02-17) - template_id i publika ärenden
**Buggfixar:**
- ✅ **Ärenden skapade via PublicTicketForm sparar nu `template_id`**
  - Redigeringsläget visar korrekt dynamiska fält

**Tekniska detaljer:**
- `PublicTicketForm.tsx`: skickar `template_id: selectedTemplate?.id`
- `server/src/routes/public.ts`: lagrar `template_id` i INSERT

### v1.4.2 (2026-02-17) - Formatfix publikt formulär
**Buggfixar:**
- ✅ Fältdata visades på en rad — fixad med `  \\n` (markdown hard line break)

### v1.4.1 (2026-02-17) - Redigering av mallärenden & fältdatafixar
**Buggfixar:**
- ✅ **Dubbla "Fältdata"-sektioner** fixad (backend är nu auktoritativ)
- ✅ **Redigering av mallärenden** visar nu korrekt dynamiska fält
  - `template_id`-kolumn tillagd via migration
  - `GET /api/tickets/:id` returnerar `field_values`
- ✅ Checkbox-fältvärden: "true"/"false" → "Ja"/"Nej"
- ✅ MarkdownTextarea för textarea-fält

### v1.4.0 (2026-02-17) - Dynamiska fält i autentiserat formulär
**Nya funktioner:**
- ✅ **Dynamiska template-fält i TicketForm (inloggad vy)**
  - Samma DynamicFieldsForm-komponent som i PublicTicketForm
  - Välj mall med fält → beskrivningsfältet ersätts av dynamiska fält
  - Fältvärden sparas strukturerat i `ticket_field_values` och som formaterad description

**Tekniska detaljer:**
- Backend: `GET /api/templates` returnerar fält per mall
- Backend: `POST /api/tickets` accepterar `customFields`
- Frontend: `Template`-interface utökat med `fields?: TemplateFieldRow[]`

### v1.3.0 (2026-02-16) - Ärendemallar & UI-förbättringar
**Nya funktioner:**
- ✅ **Ärendemallar (Ticket Templates)**
  - Fullständig mallredigerare med alla fält
  - 3 fördefinierade mallar (Lösenordsåterställning, Ny användare, Hårdvarubeställning)
  - Mallhantering i Settings (skapa, redigera, radera, omordna)
  - "Skapa från mall"-knapp i ticketformulär
  - Position-baserad sortering

**UI-förbättringar:**
- ✅ Förbättrad kontrast för checkboxar i mörkt läge
  - Tjockare ram (border-2)
  - Vit check-mark med fetare streck

**Tekniska detaljer:**
- Nya tabeller: `ticket_templates`, `template_checklists`
- Nya endpoints: `/api/templates` (GET, POST, PUT, DELETE, reorder)
- Ny komponent: `TemplateEditorModal`
- Ny hook: `useTemplates`

### v1.2.1 (2026-02-15) - E-postnotifikationer & CORS
**Nya funktioner:**
- ✅ E-postnotifikationer vid ärendeskapande och stängning
- ✅ Konfigurerbar SMTP-setup via miljövariabler
- ✅ Support för Gmail, Outlook, custom SMTP

**Säkerhetsförbättringar:**
- ✅ CORS-konfiguration med environment variables
- ✅ Stöd för flera origins

### v1.2.0 (2026-02-14) - Säkerhets- och stabilitetsfixar
**Buggfixar:**
- ✅ Tyst felhantering i useTickets.ts
- ✅ Felhantering för fil-/checklistuppladdningar
- ✅ Felaktig tokenhantering i API

**Säkerhetsförbättringar:**
- ✅ CORS-skydd (endast specifika origins)
- ✅ SQL-injektionsskydd (whitelist för UPDATE-fält)
- ✅ Filuppladdning-validering (whitelist för MIME-typer)
- ✅ JWT endast i Authorization header (borttaget från URL)
- ✅ Obligatorisk JWT_SECRET
- ✅ Filer serveras som `attachment`

---


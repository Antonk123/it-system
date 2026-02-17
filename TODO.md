# TODO - IT Ticketing System

Denna fil innehåller återstående förbättringar och nya funktioner baserat på säkerhetsanalys och funktionsanalys genomförd 2026-02-16.

**Status:** Uppdaterad efter v1.3.0 deployment

---

## 📦 VERSIONSHISTORIK

### v1.5.1 (2026-02-17) - Markdown i e-postnotifikationer & XSS-fix
**Buggfixar / Säkerhet:**
- ✅ **Markdown renderas korrekt i e-postnotifikationer** — `**Fältnamn**`-syntax konverteras nu till fetstil (`<strong>`) och radbrytningar till `<br>` istället för att visas som råtext i Outlook
- ✅ **XSS-skydd i e-postmallar** — all användarinmatning (subject, description, kategori, beställarnamn, e-post) HTML-escapas nu korrekt innan inbäddning i HTML-mail

**Tekniska detaljer:**
- `server/src/lib/email.ts`: ny `escapeHtml()` och `markdownToEmailHtml()` — escape körs före markdown-konvertering
- `white-space: pre-wrap` borttagen från beskrivnings-div (hanteras nu via `<br>`)
- Ingen frontend-ändring — enbart backend

---

### v1.5.0 (2026-02-17) - Revisionsspår / Aktivitetslogg
**Nya funktioner:**
- ✅ **Aktivitetslogg per ärende** — visar vem som gjort vad och när
  - Statusbyten: "Status: Öppen → Pågående"
  - Prioritetsändringar: "Prioritet: Medium → Hög"
  - Kategoribyten: "Kategori: X → Y" (label-namn lagras vid ändringstillfället)
  - Titel uppdaterad, Anteckningar uppdaterade, Lösning tillagd/uppdaterad
  - "Ärende skapat" loggas vid skapande via inloggad form
- ✅ Visas i ärendedetaljvyn (efter kommentarsektionen)

**Tekniska detaljer:**
- Ny tabell: `ticket_history` (id, ticket_id, user_id, field_name, old_value, new_value, changed_at)
- Skapas automatiskt via `ensureTicketHistoryTable()` i `connection.ts`
- Ny endpoint: `GET /api/tickets/:id/history` (joined med users för display_name/email)
- `PUT /api/tickets/:id` loggar ändringar av: status, priority, category_id, title, notes, solution
- `POST /api/tickets` loggar "created"-event
- Ny hook: `useTicketHistory.ts`, ny komponent: `TicketActivity.tsx`
- Buggfix under utveckling: users-tabellen använder `display_name` (inte `name`) → `COALESCE(u.display_name, u.email)`

---

### v1.4.5 (2026-02-17) - Strukturerad fältvisning & markdown i ärendedetalj
**Nya funktioner:**
- ✅ **Strukturerad visning av dynamiska fält i TicketDetail**
  - Ärenden skapade från mallar med dynamiska fält visar nu varje fält separat (etikett + värde) istället för en sammansatt textsträng
  - Varje fältvärde renderas via `MarkdownRenderer` → textarea-markdown (rubriker, listor) visas korrekt isolerat
  - Ärenden utan dynamiska fält visas som tidigare (description via MarkdownRenderer)
- ✅ **Markdown i `notes`-fältet** — `TicketDetail.tsx` och `SharedTicket.tsx` renderar nu anteckningar via `MarkdownRenderer` (tidigare plain `<p>`)

**Tekniska detaljer:**
- `TicketDetail.tsx`: nytt `ticketFieldValues`-state, anropar `api.getTicket(id)` för att hämta `field_values`
- Ingen backendändring — `GET /api/tickets/:id` returnerade redan `field_values`

---

### v1.4.4 (2026-02-17) - Hover-effekter i PublicTicketForm
**Förbättringar:**
- ✅ Kategori- och prioritets-SelectItems i `PublicTicketForm` har samma `data-[highlighted]`-hover-styling som i det autentiserade formuläret

---

### v1.4.3 (2026-02-17) - template_id i publika ärenden
**Buggfixar:**
- ✅ **Ärenden skapade via PublicTicketForm sparar nu `template_id`**
  - Tidigare: redigeringsläget visade enbart ren text för publikt skapade mallärenden
  - Nu: `template_id` skickas med och lagras → redigeringsläget visar korrekt dynamiska fält

**Tekniska detaljer:**
- `PublicTicketForm.tsx`: skickar `template_id: selectedTemplate?.id`
- `api.ts`: `submitPublicTicket` accepterar nu `template_id?`
- `server/src/routes/public.ts`: lagrar `template_id` i INSERT

---

### v1.4.2 (2026-02-17) - Formatfix publikt formulär
**Buggfixar:**
- ✅ Fältdata i ärenden skapade via PublicTicketForm visades på en rad — fixad med `  \n` (markdown hard line break)

---

### v1.4.1 (2026-02-17) - Redigering av mallärenden & fältdatafixar
**Buggfixar:**
- ✅ **Dubbla "Fältdata"-sektioner** vid sparade mallärenden — fixad (backend är nu auktoritativ för beskrivningskomposition)
- ✅ **Redigering av mallärenden** visar nu korrekt dynamiska fält (tidigare visades bara ren text)
  - `template_id`-kolumn tillagd i `tickets`-tabellen via migration
  - `GET /api/tickets/:id` returnerar `field_values`
  - `TicketForm` laddar sparade fältvärden vid redigering
- ✅ Checkbox-fältvärden ändrade från "true"/"false" till "Ja"/"Nej"
- ✅ MarkdownTextarea (Redigera/Förhandsgranska-toggle) för textarea-fält i DynamicField och TemplateEditorModal

---

### v1.4.0 (2026-02-17) - Dynamiska fält i autentiserat formulär
**Nya funktioner:**
- ✅ **Dynamiska template-fält i TicketForm (inloggad vy)**
  - Samma DynamicFieldsForm-komponent som i PublicTicketForm nu tillgänglig för inloggade användare
  - Välj en mall med fält → beskrivningsfältet ersätts av mallens dynamiska fält
  - Fältvärden sparas strukturerat i `ticket_field_values` och som formaterad description
  - Mallar utan fält fungerar precis som tidigare

**Tekniska detaljer:**
- Backend: `GET /api/templates` returnerar nu fält (fields) per mall
- Backend: `POST /api/tickets` accepterar och hanterar `customFields`
- Frontend: `Template`-interfacet utökat med `fields?: TemplateFieldRow[]`
- Frontend: `useTemplates` mappar fields från API-svar
- Frontend: `api.createTicket()` och `addTicket()` vidarebefordrar customFields

---

### v1.3.0 (2026-02-16) - Ärendemallar & UI-förbättringar
**Nya funktioner:**
- ✅ **Ärendemallar (Ticket Templates)**
  - Fullständig mallredigerare med alla fält (titel, beskrivning, prioritet, kategori, anteckningar, lösning)
  - 3 fördefinierade mallar (Lösenordsåterställning, Ny användare, Hårdvarubeställning)
  - Mallhantering i Settings (skapa, redigera, radera, omordna)
  - "Skapa från mall"-knapp i ticketformulär
  - Position-baserad sortering av mallar

**UI-förbättringar:**
- ✅ Förbättrad kontrast för checkboxar i mörkt läge
  - Tjockare ram (border-2)
  - Vit check-mark med fetare streck
  - Bättre synlighet på mörk bakgrund

**Tekniska detaljer:**
- Nya databastabeller: `ticket_templates`, `template_checklists`
- Nya API-endpoints: `/api/templates` (GET, POST, PUT, DELETE, reorder)
- Ny komponent: `TemplateEditorModal`
- Ny hook: `useTemplates` (React Query)

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

## 🐛 KRITISKA BUGGAR (7st)

### ✅ FIXADE i v1.2.0-v1.2.1
- ✅ Tyst felhantering i useTickets.ts - **FIXAD**
- ✅ Ingen felhantering för fil-/checklistuppladdningar - **FIXAD**
- ✅ Felaktig tokenhantering i API - **FIXAD**

### ❌ ÅTERSTÅENDE
- ❌ **Saknad validering av främmande nycklar**
  - **Fil:** `server/src/routes/tickets.ts:659-674`
  - **Problem:** `category_id` och `requester_id` valideras inte att de existerar innan insättning
  - **Risk:** Runtime-fel vid foreign key constraints
  - **Åtgärd:** Validera att ID:n finns i databasen innan INSERT/UPDATE
  - **Prioritet:** HÖG
  - **Uppskattad tid:** 2 timmar

- ❌ **Föräldralösa referenser vid radering av kategorier**
  - **Fil:** `server/src/routes/categories.ts:103-116`
  - **Problem:** Radering av kategorier kontrollerar inte om de refereras av ärenden
  - **Risk:** Orphaned tickets med dead category references
  - **Åtgärd:** Kontrollera användning före radering ELLER implementera CASCADE DELETE
  - **Prioritet:** HÖG
  - **Uppskattad tid:** 1-2 timmar

- ❌ **Föräldralösa referenser vid radering av kontakter**
  - **Fil:** `server/src/routes/contacts.ts:325-338`
  - **Problem:** Radering av kontakter kontrollerar inte om de refereras av ärenden
  - **Risk:** Tickets med broken requester references
  - **Åtgärd:** Kontrollera användning före radering ELLER SET NULL vid radering
  - **Prioritet:** HÖG
  - **Uppskattad tid:** 1-2 timmar

- ❌ **Partiell importframgång utan rollback**
  - **Fil:** `server/src/routes/tickets.ts:510-580`
  - **Problem:** Om 10 av 100 poster misslyckas, committas 90 och 10 failar utan rollback
  - **Risk:** Inkonsistent data vid import
  - **Åtgärd:** Rulla tillbaka hela transaktionen vid fel ELLER returnera tydlig info om failures
  - **Prioritet:** MEDEL
  - **Uppskattad tid:** 2-3 timmar

---

## ⚡ PRESTANDAPROBLEM (3st)

- ❌ **N+1-frågeproblem i export**
  - **Fil:** `server/src/routes/tickets.ts:611-615`
  - **Problem:** Separata queries för tickets, categories och contacts
  - **Impact:** Långsam export för stora datasets
  - **Åtgärd:** Använd JOINs för att hämta all data i en query
  - **Prioritet:** MEDEL
  - **Uppskattad tid:** 2 timmar

- ❌ **Ingen paginering på kontaktlista**
  - **Fil:** `server/src/routes/contacts.ts:19-28`
  - **Problem:** Alla kontakter laddas och skickas (kunde vara 10,000+)
  - **Impact:** Långsam initial load, hög minnesanvändning
  - **Åtgärd:** Implementera paginering som i tickets-endpoint
  - **Prioritet:** MEDEL
  - **Uppskattad tid:** 2 timmar

- ❌ **Ineffektiv kategoriomordning**
  - **Fil:** `server/src/routes/categories.ts:60-66`
  - **Problem:** N separata UPDATE-satser för varje kategori
  - **Impact:** Långsam vid många kategorier
  - **Åtgärd:** Använd bulk UPDATE eller CASE-sats
  - **Prioritet:** LÅG
  - **Uppskattad tid:** 1 timme

---

## 🔐 SÄKERHETSFÖRBÄTTRINGAR

### ✅ IMPLEMENTERADE i v1.2.0-v1.2.1
- ✅ CORS-skydd (endast specifika origins)
- ✅ SQL-injektionsskydd (whitelist för UPDATE-fält)
- ✅ Filuppladdning-validering (whitelist för MIME-typer)
- ✅ JWT endast i Authorization header (borttaget från URL)
- ✅ Obligatorisk JWT_SECRET
- ✅ Filer serveras som `attachment`

### 🔴 ÅTERSTÅENDE - HÖG PRIORITET

- ❌ **Rate Limiting**
  - **Platser:** `/api/auth/login`, `/api/public/tickets`, alla API endpoints
  - **Risk:** Brute-force attacker, DOS-attacker
  - **Åtgärd:** Implementera express-rate-limit middleware
  - **Prioritet:** HÖG
  - **Uppskattad tid:** 3-4 timmar
  - **Exempel:**
    ```typescript
    import rateLimit from 'express-rate-limit';

    const loginLimiter = rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 attempts
      message: 'Too many login attempts, please try again later'
    });

    app.use('/api/auth/login', loginLimiter);
    ```

- ✅ **XSS-skydd i e-postmallar** — **FIXAD i v1.5.1**
  - **Fil:** `server/src/lib/email.ts`
  - All användarinmatning (subject, description, kategori, beställarnamn, e-post) HTML-escapas nu via `escapeHtml()` innan inbäddning i HTML-mall

- ❌ **CSRF-skydd**
  - **Problem:** Inga CSRF-tokens för state-changing requests
  - **Risk:** Cross-site request forgery attacker
  - **Åtgärd:** Implementera CSRF tokens (csurf middleware)
  - **Prioritet:** MEDEL-HÖG
  - **Uppskattad tid:** 4-5 timmar

### 🟡 ÅTERSTÅENDE - MEDEL PRIORITET

- ❌ **Starkare lösenordspolicy**
  - **Fil:** `server/src/routes/auth.ts:51`
  - **Nuvarande:** 6-teckens minimum, inga komplexitetskrav
  - **Åtgärd:** Öka till 12+ tecken, kräv versaler/siffror/specialtecken
  - **Prioritet:** MEDEL
  - **Uppskattad tid:** 2 timmar

- ❌ **Token refresh & revocation**
  - **Problem:** JWT tokens lever i 7 dagar, ingen revocation-mekanism
  - **Åtgärd:** Implementera refresh tokens, kortare access token TTL (1h)
  - **Prioritet:** MEDEL
  - **Uppskattad tid:** 6-8 timmar

- ❌ **Säker random generation**
  - **Fil:** `server/src/routes/users.ts:53`
  - **Problem:** Använder `Math.random()` för lösenordsgenerering
  - **Åtgärd:** Använd `crypto.randomBytes()`
  - **Prioritet:** MEDEL
  - **Uppskattad tid:** 30 minuter

### 🟢 ÅTERSTÅENDE - LÅG PRIORITET

- ❌ **HTTPS-enforcing**
  - **Åtgärd:** Redirect från HTTP till HTTPS, HSTS headers
  - **Prioritet:** LÅG (redan på HTTPS i prod)
  - **Uppskattad tid:** 1-2 timmar

- ❌ **Security Headers**
  - **Headers:** CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy
  - **Åtgärd:** Implementera helmet.js
  - **Prioritet:** LÅG
  - **Uppskattad tid:** 2 timmar

---

## 🎯 FUNKTIONSFÖRSLAG

### 🔴 PRIORITET 1: Kritiska funktioner (Implementera snarast)

- ❌ **Ärendetilldelning till handläggare** ⭐⭐⭐
  - **Status:** Saknas helt - ingen `assigned_to` fält i schemat
  - **Värde:** KRITISKT för agent-workflow
  - **Funktioner:**
    - Tilldela ärenden till specifika användare
    - "Mina ärenden"-vy
    - Arbetsbelastningsdistribution
    - Filter/sortering på tilldelad handläggare
  - **Implementation:**
    - Migration: Lägg till `assigned_to` kolumn i `tickets` tabell
    - Backend: Uppdatera routes för assignment
    - Frontend: Dropdown för assignment, "My Tickets" filter
  - **Uppskattad tid:** 3-4 timmar

- ❌ **Förbättrade e-postnotifikationer** ⭐⭐⭐
  - **Status:** Endast vid skapande/stängning, fast mottagare
  - **Värde:** HÖGT - användare omedvetna om uppdateringar
  - **Funktioner:**
    - Notifiera ärendeförfrågan vid uppdateringar
    - Notifiera tilldelad agent vid ny assignment
    - Konfiguerbara notifieringsregler
    - Mallar för olika händelser (created, updated, assigned, closed)
  - **Implementation:**
    - Event-driven notifications (på ticket update)
    - Dynamiska mottagare baserat på ärendets kontext
    - Inställningar för notifieringspreferenser
  - **Uppskattad tid:** 4-5 timmar

- ✅ **Revisionsspår / Aktivitetslogg** ⭐⭐⭐ - ✅ **IMPLEMENTERAD i v1.5.0**
  - **Status:** Implementerad
  - **Värde:** HÖGT - Compliance, ansvar, felsökning
  - **Funktioner:**
    - Vem ändrade vad och när (status, prioritet, kategori, titel, anteckningar, lösning)
    - Aktivitetslogg visas i ärendedetaljvyn
  - **Implementerad tid:** ~2 timmar

- ❌ **SLA (Service Level Agreement) -spårning** ⭐⭐
  - **Status:** Saknas
  - **Värde:** HÖGT - Professionella supportoperationer
  - **Funktioner:**
    - Svarstidsmål (time to first response)
    - Lösningstidsmål (time to resolution)
    - Eskaleringsregler
    - Visuella indikatorer för SLA-överträdelser
    - Dashboard-varningar
  - **Implementation:**
    - Tabell: `sla_configs` (priority -> response_time, resolution_time)
    - Beräkna SLA-status per ärende (based on priority + created_at)
    - Färgkodning i UI (green/yellow/red)
  - **Uppskattad tid:** 8-10 timmar

### 🟡 PRIORITET 2: Viktiga förbättringar (Planera in)

- ❌ **Taggar/Etiketter-system** ⭐⭐
  - **Värde:** MEDEL - Bättre organisation
  - **Funktioner:**
    - Flervalsetiketter per ärende (ex: "urgent", "customer-facing", "bug")
    - Snabb filtrering på taggar
  - **Implementation:**
    - Tabeller: `tags`, `ticket_tags` (många-till-många)
    - UI för etikettshantering (skapa, ta bort, färger)
  - **Uppskattad tid:** 2-3 timmar

- ❌ **Färdiga svar / Svarsbibliotek** ⭐⭐
  - **Värde:** MEDEL - Snabbare agentsvarstid
  - **Funktioner:**
    - Förskrivna svar för vanliga problem
    - Snabb infogning i kommentarer
    - Kategoriserat svarsbibliotek
  - **Implementation:**
    - Tabell: `canned_responses` (title, content, category)
    - UI: Modal med sökbara svar, klicka för att infoga
  - **Uppskattad tid:** 3-4 timmar

- ✅ **Ärendemallar** ⭐⭐ - ✅ **IMPLEMENTERAD i v1.3.0**
  - **Värde:** MEDEL - Snabba upp ärendeskapande, konsistens
  - **Funktioner:**
    - Förfyllda titel, beskrivning, kategori, prioritet, anteckningar, lösning
    - Mallar för vanliga problemtyper (ex: "Lösenordsåterställning", "Ny användare")
    - Fullständig mallredigerare med alla fält
    - Position-baserad ordning av mallar
    - 3 fördefinierade mallar
  - **Implementation:**
    - Tabell: `ticket_templates`, `template_checklists`
    - Backend: `/api/templates` routes (GET, POST, PUT, DELETE, reorder)
    - Frontend: TemplateEditorModal-komponent
    - Settings: Mallhantering med skapa/redigera/radera/omordna
    - TicketForm: "Skapa från mall"-knapp med template selector
  - **Implementerad tid:** 3.5 timmar

- ❌ **Avancerad rollbaserad åtkomstkontroll (RBAC)** ⭐
  - **Status:** Endast 2 roller (admin/user)
  - **Värde:** MEDEL - Multi-tenant-stöd
  - **Funktioner:**
    - Agentroll, Chefsroll, Förfrågansroll med olika behörigheter
    - Teamtilldelning och synlighet
    - Fältnivåkontroll
  - **Implementation:**
    - Utöka rollsystem i DB
    - Middleware för behörighetskontroll
    - Permission checks på alla endpoints
  - **Uppskattad tid:** 15-20 timmar

### 🟢 PRIORITET 3: Trevliga att ha (Framtida backlog)

- ❌ **Kunskapsbas / FAQ**
  - **Värde:** MEDEL - Minska ärendemängd, självbetjäning
  - **Funktioner:**
    - Skapa och hantera artiklar
    - Kategorisering
    - Sök i KB
    - Länka artiklar till ärenden
  - **Uppskattad tid:** 10-12 timmar

- ❌ **Kundnöjdhetsbetyg (CSAT)**
  - **Värde:** MEDEL - Kvalitetsmått
  - **Funktioner:**
    - Betygsättning efter löst ärende (1-5 stjärnor)
    - Feedback-kommentarer
    - Rapporter över kundnöjdhet
  - **Uppskattad tid:** 2-3 timmar

- ❌ **Tidsspårning**
  - **Värde:** MEDEL - Resursplanering, fakturering
  - **Funktioner:**
    - Logga tid spenderad på ärenden
    - Rapporter över tidsanvändning
  - **Uppskattad tid:** 2-3 timmar

- ❌ **Bulkoperationer**
  - **Värde:** MEDEL - Admineffektivitet
  - **Funktioner:**
    - Bulk status change
    - Bulk assignment
    - Bulk delete
  - **Uppskattad tid:** 2-3 timmar

---

## 📊 Sammanfattning

| Kategori | Totalt | Fixade | Återstående |
|----------|--------|--------|-------------|
| Kritiska buggar | 7 | 3 | 4 |
| Prestandaproblem | 3 | 0 | 3 |
| Säkerhetsförbättringar | 15 | 7 | 8 |
| Funktioner (Prio 1) | 4 | 1 | 3 |
| Funktioner (Prio 2) | 4 | 1 | 3 |
| Funktioner (Prio 3) | 4 | 0 | 4 |
| **TOTALT** | **37** | **12** | **25** |

---

## 🎯 Rekommenderad arbetsordning

### Nästa sprint (1-2 veckor)
1. Fixa återstående kritiska buggar (foreign key validation, orphaned references)
2. Implementera rate limiting
3. XSS-skydd i e-postmallar
4. Ärendetilldelning

### Sprint 2 (2-3 veckor)
1. Förbättrade e-postnotifikationer
2. Starkare lösenordspolicy
3. Prestandaoptimeringar (N+1, paginering)

### Sprint 3 (3-4 veckor)
1. SLA-spårning
2. Taggar/Etiketter
3. Färdiga svar
4. CSRF-skydd

### Långsiktig backlog (3+ månader)
1. Avancerad RBAC
2. Kunskapsbas
3. Token refresh & revocation
4. Security headers

---

**Senast uppdaterad:** 2026-02-17
**Version:** Efter v1.5.1 deployment

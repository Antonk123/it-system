# Arbetslogg 2026-04-10

## Sammanfattning

Session med fokus på infrastruktur, säkerhet och stabilitet. SSH-nyckel konfigurerad, bygge fixat, alla npm-sårbarheter eliminerade, API-validering och rate limiting tillagd, kritisk auth-bugg upptäckt och fixad, samt dev-miljö uppsatt.

---

## 1. SSH-nyckel till GitHub

- Genererade ny ED25519-nyckel (`~/.ssh/id_ed25519_github`)
- Lade till den på GitHub via `gh ssh-key add`
- Konfigurerade `~/.ssh/config` med `IdentityFile` och `IdentitiesOnly` for github.com
- Verifierade att `git push` fungerar via SSH

## 2. Fixat trasigt bygge (SIGBUS)

**Problem:** `vite build` kraschade med SIGBUS (Bus error) — både lokalt och i Docker.

**Orsak:** Korrupta npm-paket i `node_modules/`. `@swc/core-linux-x64-gnu` var trunkerad (~20% av förväntad storlek), och `framer-motion` samt `motion-dom` saknade entry-filer. Trolig orsak: avbruten `npm install`.

**Fix:** `rm -rf node_modules && npm install` — fullständig reinstallation.

**Commit:** `dded40b` (FTS5-sökning) pushades efter bygget fixades.

## 3. npm-sårbarheter eliminerade

**Problem:** 12 sårbarheter (3 moderate, 9 high) rapporterade av `npm audit`.

**Åtgärder:**
- `npm audit fix` fixade 8 av 12 (brace-expansion, dompurify, flatted, lodash, minimatch, picomatch, vite, yaml)
- Lade till `overrides` i `package.json` för `serialize-javascript >= 7.0.5` — fixade resterande 4 som hängde i beroendekedjan `vite-plugin-pwa` -> `workbox-build` -> `@rollup/plugin-terser` -> `serialize-javascript`

**Resultat:** 12 -> 0 sårbarheter.

**Commit:** `2062fbe fix(deps): resolve all npm audit vulnerabilities`

## 4. API-härdning

### Inputvalidering (status/priority)

**Problem:** `POST /api/tickets` och `PUT /api/tickets/:id` accepterade godtyckliga strängar för `status` och `priority` — kunde skriva ogiltiga värden direkt till databasen. `PUT /api/tickets/bulk` hade redan validering.

**Fix:**
- Extraherade `VALID_STATUSES` och `VALID_PRIORITIES` till modulkonstanter
- Lade till enum-validering på `POST /` och `PUT /:id` (matchar befintlig logik i bulk-endpointen)
- Tog bort duplicerade lokala variabler i `validateTicketRow` och bulk-handler

### Rate limiting

**Problem:** Bara `/api/auth/login` hade rate limiting. Skriv-endpoints (skapa ärenden, bulk-uppdatering, bulk-radering) saknade skydd mot missbruk.

**Fix:**
- Skapade `writeRateLimiter` (60 req/min) i `rateLimit.ts`
- Applicerade på `POST /api/tickets`, `PUT /api/tickets/bulk` och `POST /api/tickets/bulk-delete`

### Accessibility

**Fix:** Lade till `aria-label` på:
- Logout-knappen i `Layout.tsx` ("Logga ut")
- Sidofälts-toggle i `Layout.tsx` ("Dölj sidofält" / "Visa sidofält")

**Commit:** `1f15221 harden API: add input validation, rate limiting, and aria labels`

## 5. Hälsokontroll och kritisk auth-bugg

### Hälsokontroll

Körde systematisk hälsokontroll av hela systemet:

| Område | Status |
|--------|--------|
| Docker containers | PASS |
| Databasstruktur (40+ tabeller) | PASS |
| FTS5 fulltext-sökning | PASS |
| Frontend prod + dev | PASS |
| Tester (12/12) | PASS |
| npm audit (0 sårbarheter) | PASS |
| ESLint | WARN (1 varning i CommandPalette.tsx) |
| **Login/Auth** | **FAIL** |

### Kritisk bugg: Login trasigt

**Problem:** Varje inloggningsförsök returnerade HTTP 500. `refresh_tokens`-tabellen refererades i `auth.ts` och `cleanup-refresh-tokens.ts` men hade aldrig skapats.

**Fix:**
- Lade till migration `026: create_refresh_tokens_table` med kolumner: id, user_id, token, expires_at, revoked, created_at, last_used_at
- Index på user_id, token och expires_at
- Skapade `.env` med `JWT_SECRET` (gitignored)

**Verifiering:** `curl -X POST /api/auth/login` returnerar 200 med JWT-token.

**Commit:** `eee81a3 fix(auth): add refresh_tokens table migration`

## 6. Dev-miljö uppsatt

Skapade en separat dev-miljö som körs parallellt med produktion:

| Miljö | Frontend | Backend |
|-------|----------|---------|
| Produktion | port 8082 (nginx) | port 3002 |
| Dev | port 5173 (Vite hot reload) | port 3003 |

**Filer (gitignored):**
- `docker-compose.dev.yml` — separat compose med dev-containers och egen databasvolym
- `Dockerfile.dev.client` — Vite dev-server med hot reload
- `.env` — JWT_SECRET

**Egenskaper:**
- Hot reload via Vite — ändringar i `src/` syns direkt
- Egen databas (`it-ticketing-data-dev` volume) — separerad från produktion
- Vite proxy vidarebefordrar `/api` till dev-backend automatiskt

---

## Commits (denna session)

| Hash | Meddelande |
|------|-----------|
| `2062fbe` | fix(deps): resolve all npm audit vulnerabilities |
| `1f15221` | harden API: add input validation, rate limiting, and aria labels |
| `eee81a3` | fix(auth): add refresh_tokens table migration |

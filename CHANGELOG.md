# Changelog

Alla noterbara ändringar i IT-Ticket dokumenteras här.

Formatet följer [Keep a Changelog](https://keepachangelog.com/sv/1.1.0/) och
projektet använder [semantisk versionering](https://semver.org/lang/sv/).

IT-Ticket levereras rullande från `main` (en instans per deployment). Sektionen
**[Orutinerat]** speglar det aktuella `main` som ännu inte taggats som release.

## [Orutinerat]

Omfattande vidareutveckling sedan v1.5 (april 2026). Sammanfattat per tema —
för commit-nivå, se git-historiken.

### Tillagt
- **Delningslänks-expiry:** Publika delningslänkar för ärenden får nu konfigurerad
  utgångstid (default 30 dagar, valbart 1–365 dagar vid skapande). Utgångna länkar
  returnerar 404 (fail-closed). `POST /api/shares/ticket/{ticketId}` accepterar nu
  valfri `{ "expiresInDays": <int> }` i body; `GET /api/shares/ticket/{ticketId}`
  och `GET /api/shares/public/{token}` rapporterar `expires_at` / `share_expires_at`.
  **Viktig drift-not:** befintliga delningslänkar (skapade före uppgraderingen) får
  automatiskt `expires_at = uppgraderingstidpunkt + 30 dagar` via migration 067 —
  de slutar fungera 30 dagar efter deploy om inte beställaren av ärendet/tekniker
  manuellt förnyar länken. Audit-loggning av `share_create` / `share_delete` med
  `api_key_id`-attribution vid API-nyckelbaserade åtgärder.
- **SSO-inloggning (OIDC):** Authorization Code + PKCE mot valfri IdP (t.ex.
  Microsoft Entra ID). Aktiveras med `OIDC_*`-env-vars — SSO-knappen visas bara
  när allt är konfigurerat. Kräver befintligt konto (ingen auto-provisionering):
  en okänd identitet nekas (`/login?sso_error=unknown_user`) i stället för att
  skapas. Identiteten matchas på **paret** (`oidc_sub`, `oidc_iss`) — `sub` är
  bara unikt inom en issuer, så issuern lagras bredvid i kolumnen `oidc_iss`
  (migration 068, som också ersätter unik-indexet på `oidc_sub` med ett på
  paret). Finns ingen länkad rad härleds **exakt en** adress ur claims och
  matchas mot `users.email`, i förtroendeordning som beror på om IdP:n är
  Entra: på en Entra-issuer `preferred_username` när den innehåller `@` (för en
  tenant-medlem normalt UPN:en, vars suffix Entra kräver ska vara en
  verifierad domän — men `preferred_username` är Microsofts egen dokumenterat
  ostabila claim, så förtroendet är gatat till just Entra-issuers), annars
  `email` men bara när den är positivt verifierad (`xms_edov: true` eller
  `email_verified: true`); på en generisk OIDC-issuer bara `email` med
  `email_verified: true` — utan Entras UPN-domängaranti finns inget annat att
  lita på. **Ingen fallback:** matchar den valda adressen inget konto blir
  svaret `unknown_user` — nästa claim provas aldrig som andra chans, eftersom
  en overifierad `email` kan komma från `otherMails` som användaren själv kan
  sätta (nOAuth). En admin kan **koppla loss SSO-länken** på ett konto
  (Inställningar → Administration → Systemanvändare → "Koppla loss SSO"); det
  nollar både `oidc_sub` och `oidc_iss` och återkallar kontots refresh-tokens
  (ett redan utfärdat access-token lever dock kvar i upp till 15 minuter).
  **Endast en tenant kan autentisera** — `OIDC_ISSUER_URL` måste namnge exakt
  en tenant. `/common` och `/organizations` avvisas eftersom deras issuer är en
  platshållarmall som gör `iss`-kontrollen självrefererande (vilken Entra-tenant
  som helst skulle validera); `/consumers` avvisas på segmentnamnet, och
  Microsofts konsument-tenant (`9188040d-…`) även på GUIDen i den upptäckta
  issuern — den ger nämligen en konkret issuer och fångas inte av
  platshållarkontrollen. Egna rate-limiters för login/callback.
  **Viktig drift-not:** konton som SSO-länkades före migration 068 har
  `oidc_sub` satt men `oidc_iss` NULL — den halva identiteten kan inte bevisas
  tillhöra den konfigurerade issuern, så de kontona nekas vid SSO-inloggning
  tills en admin kopplar loss länken (kontot länkas då om vid nästa lyckade
  inloggning). Lösenordsinloggning påverkas inte.
- **Markdown-bilagor:** `.md`/`.markdown` tillåtna som ticket-bilagor (validering
  i alla tre lager: filväljare, klient-schema, backend-allowlist).
- **Tvåvägs-e-post / kundloop:** teknikerns publika svar mejlas trådat till
  beställaren; inkommande kundsvar blir kommentar och notifierar tilldelad
  tekniker (push/mejl/webhook). Admin-styrd på/av i Integrationer.
- **Äkta fakturor:** global gapless löpnummerserie, moms (25 % default,
  överstyrbar per faktura), billbar tid med arbetsdatum och redigering, samt
  skydd mot dubbelfakturering (tidsposter stämplas med `invoice_id`).
- **SLA-verkställighet:** schemalagd kontroll flaggar passerade SLA-deadlines på
  öppna ärenden och eskalerar via webhook/mejl/push.
- **Backup-schema-UI:** pausa, schemalägg tid, retention och kör-nu från admin.
- **AI-funktioner:** deflection-portal, svarsutkast, sammanfattning och
  kategoriförslag (Claude), med månatlig token-circuit-breaker.
- **Kunskapsbas:** bulk-import (`.md`/`.txt` med YAML-frontmatter), bild-lightbox,
  fulltextsökning (FTS5), Markdown→HTML med GFM.
- **Integration & API:** API-nycklar (SHA-256), HMAC-signerade webhooks,
  e-post→ärende via IMAP (M365 OAuth2), web push, PWA.

### Ändrat
- **BRYTANDE — API-nycklar kräver `admin`-scope för administrativa endpoints.**
  Tidigare räckte det att nyckelns *ägare* var administratör, vilket gjorde att
  en nyckel avsedd för läsning nådde hela admin-ytan. Nyckeln är credentialen
  och dess scope kan bara inskränka åtkomsten, aldrig utöka den.
  **Efter uppgradering slutar befintliga nycklar fungera mot admin-endpoints**
  (inklusive backup-nedladdning) — skapa en ny nyckel med Admin-scope under
  Inställningar → Integrationer. Detta är avsiktligt: att retroaktivt ge
  gamla nycklar admin-scope hade bevarat sårbarheten.
- Tidszonshantering konsekvent `Europe/Stockholm` i hela stacken.
- Stora refaktorer av Settings; UI/UX- och tillgänglighetslyft (WCAG AA-kontrast
  i ljusa teman, badge-kontraster, Kanban-tangentbordsnavigering).
- Node 20 → 22; vendor-bundle code-split.

### Fixat
- Hundratals buggfixar över flera kodaudits (v1–v4), bl.a. IDOR-härdning,
  en render-loop i ärendeformuläret, FTS5-triggers, e-post-deduplicering och
  diverse export-/UX-buggar. Senast: kommentar-editorn tömdes inte efter spar,
  och `schema.sql` kraschade startup på äldre databaser.

### Säkerhet
- **Privilege escalation via API-nycklar stängd.** En nyckel scopad `read`,
  bunden till en administratör, kunde nå samtliga admin-skyddade endpoints —
  däribland `GET /api/backup`, som laddar ner hela databasen inklusive
  hemligheter. En nyckel kan heller inte längre mynta en nyckel med scope den
  själv saknar.
- **Spårbarhet för administrativa åtgärder.** `audit_log` har ett nytt fält för
  vilken API-nyckel som utförde åtgärden, backup-routerna loggar (de gjorde det
  inte alls tidigare), och granskningsloggen visar nyckelns härkomst.
  Restore-loggen skrivs i den återställda databasen — annars hade just den
  åtgärd som raderar historiken varit den enda utan spår.
- Återkommande säkerhetsaudits; fail-closed-validering av `JWT_SECRET`/
  `CSRF_SECRET` (saknad eller < 32 tecken stoppar start), CSRF-skydd, SSRF-skydd,
  rate-limits, parametriserad SQL med allow-listade kolumnnamn.
- CI-härdning: Dependabot (veckovis) + `scripts/audit-check.mjs`-gate (allowlist
  med skriven motivering och expiry-datum per undantag), samt verkställd
  coverage-ratchet i CI.

## [1.5] – 2026-04-06
## [1.4] – 2026-04-05
## [1.2] – 2026-03-29
## [1.1] – 2026-03-29
## [1.0] – 2026-03-22

Tidiga releaser med kärnan på plats: ärendehantering med full livscykel,
kunskapsbas, multi-user med roller, samt de första AI-, tidsrapporterings- och
faktureringsfunktionerna. Detaljerad changelog infördes från och med
[Orutinerat] ovan.

[Orutinerat]: https://github.com/Antonk123/it-system/compare/v1.5...HEAD
[1.5]: https://github.com/Antonk123/it-system/compare/v1.4...v1.5
[1.4]: https://github.com/Antonk123/it-system/compare/v1.2...v1.4
[1.2]: https://github.com/Antonk123/it-system/compare/v1.1...v1.2
[1.1]: https://github.com/Antonk123/it-system/compare/v1.0...v1.1
[1.0]: https://github.com/Antonk123/it-system/releases/tag/v1.0

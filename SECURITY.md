# Säkerhetsinstruktioner - IT Ticketing System

## 🔴 KRITISKT: Omedelbar åtgärd krävs

### 1. JWT_SECRET Miljövariabel

**Status:** OBLIGATORISK - Systemet startar INTE utan denna variabel

**Problem:** JWT_SECRET används för att signera och verifiera autentiseringstokens. Om denna inte sätts korrekt kan angripare förfalska giltiga tokens och få obehörig åtkomst.

**Åtgärd:**

```bash
# Generera en stark JWT_SECRET (32 bytes base64)
openssl rand -base64 32

# Exempel output:
# 8Xm9K3vN2pQ7rL5wT6yU1zA4sD3fG8hJ9kM0nB2vC5x=
```

**Sätt miljövariabeln:**

```bash
# I .env-fil (lägg till i .gitignore!)
JWT_SECRET=8Xm9K3vN2pQ7rL5wT6yU1zA4sD3fG8hJ9kM0nB2vC5x=

# För Docker Compose (i docker-compose.yml eller .env):
JWT_SECRET=8Xm9K3vN2pQ7rL5wT6yU1zA4sD3fG8hJ9kM0nB2vC5x=

# För Portainer:
# Lägg till i "Environment variables" sektionen när du skapar/updaterar stacken
```

**VIKTIGT:**
- ✅ Använd minst 32 bytes (256 bitar) slumpmässig data
- ✅ Spara lösenordet säkert (lösenordshanterare)
- ✅ Olika hemmeligheter för utveckling och produktion
- ❌ Aldrig checka in i Git
- ❌ Aldrig dela i Slack/Email
- ❌ Aldrig återanvänd mellan miljöer

---

### 2. SMTP-lösenord

**Status:** EXPONERAT - Rotera omedelbart

**Problem:** SMTP-lösenordet för `it@prefabmastarna.se` finns i `itticket-prod.env` och kan ha checkats in i Git.

**Omedelbar åtgärd:**

1. **Rotera SMTP-lösenordet:**
   - Logga in på din e-postleverantör
   - Ändra lösenordet för SMTP-kontot
   - Generera nytt starkt lösenord (12+ tecken, blandade tecken)

2. **Uppdatera miljövariabeln:**

```bash
# I .env-fil (lägg till i .gitignore!)
SMTP_PASS=nytt_starkt_lösenord_här

# För Docker/Portainer:
# Uppdatera environment variable SMTP_PASS
```

3. **Ta bort från Git-historik (om den checkats in):**

```bash
# Kontrollera om filen finns i Git
git log --all --full-history -- itticket-prod.env

# Om den finns, använd git-filter-repo eller BFG Repo-Cleaner
# VARNING: Detta skriver om Git-historiken!

# Eller enklare: Skapa nytt repo med ren historik om möjligt
```

4. **Lägg till i .gitignore:**

```bash
# I .gitignore
*.env
.env
.env.*
!.env.example
```

---

### 3. CORS-konfiguration

**Status:** FIXAD ✅

**Ändring:** CORS accepterar nu endast specifika origins istället för `*`.

**Konfiguration:**

```bash
# Sätt tillåtna origins (kommaseparerade)
CORS_ORIGIN=http://10.38.195.180:8082,https://din-domän.se

# Om inte satt, används development defaults:
# - http://localhost:5173 (Vite dev)
# - http://localhost:8082 (Docker frontend)
```

---

## 📋 Produktionschecklist

Innan deploy till produktion, verifiera:

### Miljövariabler
- [ ] `JWT_SECRET` är satt (32+ bytes, slumpmässig)
- [ ] `SMTP_PASS` är roterat och säkert
- [ ] `CORS_ORIGIN` är satt till produktion-domäner
- [ ] `NODE_ENV=production`
- [ ] `DB_PATH` pekar på rätt plats

### Säkerhet
- [ ] Alla `.env`-filer i `.gitignore`
- [ ] Inga hemligheter i Git-historik
- [ ] HTTPS aktiverat (rekommenderat)
- [ ] Firewall-regler konfigurerade
- [ ] Endast nödvändiga portar öppna

### Standardlösenord
- [ ] Admin-lösenordet ändrat från `admin123`
- [ ] Alla användare har starka lösenord
- [ ] Tvinga lösenordsbyte vid första inloggning

---

## 🔒 Säkerhetsförbättringar implementerade

### ✅ Genomförda åtgärder (v1.2.0)

1. **CORS-skydd**
   - ❌ Tidigare: `origin: '*'` tillät alla webbplatser
   - ✅ Nu: Endast specifika origins tillåtna

2. **SQL-injektionsskydd**
   - ❌ Tidigare: Dynamiska fältnamn i UPDATE-satser
   - ✅ Nu: Whitelist för tillåtna fältnamn i `tickets.ts`, `contacts.ts`

3. **Filuppladdning-säkerhet**
   - ❌ Tidigare: Alla filtyper tillåtna, serverade som `inline`
   - ✅ Nu:
     - Whitelist för MIME-typer och filextensions
     - Filer serveras som `attachment` (tvingar nedladdning)
     - Max 10MB filstorlek
     - Filnamn-sanitering

4. **JWT i URL fixat**
   - ❌ Tidigare: JWT tokens i URL query parameters
   - ✅ Nu:
     - Endast Authorization header accepteras
     - Frontend använder fetch() med headers för filer
     - Blob URLs för bilder och nedladdningar

5. **Felhantering förbättrad**
   - ❌ Tidigare: Fel ignorerades tyst i `useTickets.ts`
   - ✅ Nu: Fel propageras korrekt, toast-meddelanden visas

6. **JWT_SECRET obligatorisk**
   - ❌ Tidigare: Hårdkodad fallback-hemmelighet
   - ✅ Nu: Systemet kraschar om JWT_SECRET inte är satt

---

## 🔐 Tillåtna filtyper

Systemet accepterar endast följande filtyper för uppladdning:

**Bilder:**
- `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`, `.svg`

**Dokument:**
- `.pdf` (PDF)
- `.txt`, `.csv` (Text)
- `.doc`, `.docx` (Word)
- `.xls`, `.xlsx` (Excel)
- `.ppt`, `.pptx` (PowerPoint)

**Arkiv:**
- `.zip`, `.rar`, `.7z`

Filstorlek max: **10 MB**

För att lägga till fler filtyper, uppdatera `ALLOWED_MIME_TYPES` och `ALLOWED_EXTENSIONS` i:
- `server/src/routes/attachments.ts`

---

## 📞 Kontakt vid säkerhetsproblem

Om du upptäcker säkerhetsproblem:
1. **PUBLICERA INTE** problemet publikt
2. Kontakta ansvarig utvecklare direkt
3. Inkludera detaljerad beskrivning och steg för att reproducera

---

## 🚧 Återstående säkerhetsarbete

### Hög prioritet (Fas 2)

1. **Auktoriseringskontroller**
   - Implementera kontroller att användare endast kan se sina egna ärenden
   - Rollbaserad åtkomst (admin vs user)
   - Begränsa åtkomst till kommentarer, bilagor, etc.

2. **Rate Limiting**
   - Implementera express-rate-limit
   - Särskilt på `/api/auth/login` och `/api/public/tickets`
   - Förhindra brute-force attacker

3. **XSS-skydd i e-post**
   - HTML-escape all användarinmatning i e-postmallar
   - Använd säkert mallbibliotek (Handlebars, EJS med auto-escape)

4. **CSRF-skydd**
   - Implementera CSRF tokens för state-changing requests
   - Särskilt viktigt för formulär

### Medel prioritet (Fas 3)

1. **Lösenordspolicy**
   - Öka från 6 till 12 tecken minimum
   - Kräv blandning av versaler, siffror, specialtecken
   - Implementera zxcvbn för styrkevalidering

2. **Token refresh & revocation**
   - Implementera refresh tokens
   - Möjlighet att ogiltigförklara tokens vid utloggning
   - Kortare TTL för access tokens (1h istället för 7d)

3. **Säker random generation**
   - Använd `crypto.randomBytes()` istället för `Math.random()`
   - För lösenordsgenerering i `users.ts`

### Låg prioritet (Fas 4)

1. **HTTPS-enforcing**
   - Implementera redirect från HTTP till HTTPS
   - HSTS headers

2. **Security Headers**
   - Content-Security-Policy (CSP)
   - X-Frame-Options: DENY
   - X-Content-Type-Options: nosniff
   - Referrer-Policy: strict-origin-when-cross-origin

3. **Audit logging**
   - Logga alla viktiga händelser
   - Vem gjorde vad, när
   - Lagra loggar säkert

---

## 📚 Referenser

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [OWASP JWT Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_for_Java_Cheat_Sheet.html)
- [OWASP File Upload](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [Express Security Best Practices](https://expressjs.com/en/advanced/best-practice-security.html)

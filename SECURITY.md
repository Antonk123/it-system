# Säkerhetspolicy

IT-Ticket hanterar autentisering, kunddata, fakturering och e-postintegration.
Vi tar säkerhetsrapporter på allvar och uppskattar ansvarsfull rapportering.

## Rapportera en sårbarhet

**Öppna inte ett publikt issue för säkerhetsbrister.**

Använd istället GitHubs privata kanal:

1. Gå till repots **Security**-flik → **Report a vulnerability**
   ([Privata security advisories](https://github.com/Antonk123/it-system/security/advisories/new)).
2. Beskriv sårbarheten, påverkan och reproduktionssteg.

Om du inte kan använda GitHub-flödet, kontakta underhållaren via profilen
[@Antonk123](https://github.com/Antonk123).

### Vad du kan förvänta dig

| Steg | Mål |
|------|-----|
| Bekräftelse på mottagen rapport | inom 3 arbetsdagar |
| Första bedömning (allvarsgrad, scope) | inom 7 arbetsdagar |
| Åtgärd / fix | beroende på allvarsgrad; CRITICAL/HIGH prioriteras |

Vi krediterar gärna rapportörer i release-noteringen om så önskas.

## Scope

**I scope:** autentisering/sessioner (JWT, refresh tokens), CSRF, API-nyckel-
hantering, webhook-signering, behörighetskontroller (IDOR), SQL-injection, XSS,
SSRF, exponering av hemligheter eller kunddata, samt den publika deflection-
portalen och e-post→ärende-flödet.

**Utanför scope:** sårbarheter som kräver fysisk åtkomst till servern, social
engineering, eller brister i tredjepartsberoenden utan en demonstrerbar
exploaterbar väg i IT-Ticket (rapportera dessa uppströms; vi spårar dem via
Dependabot + `npm audit` i CI).

## Säkerhetsmodell (kort)

- **Auth:** JWT-access tokens (15 min) + roterande refresh tokens.
- **API-nycklar:** SHA-256-hashade, prefix-lookup — rånyckeln lagras aldrig.
- **Webhooks:** HMAC-signerade event.
- **CSRF:** dubbel-submit via `csrf-csrf`, `X-CSRF-Token`-header på muterande anrop.
- **Hemligheter:** backend vägrar starta (`process.exit(1)`) om `JWT_SECRET`
  eller `CSRF_SECRET` saknas, eller är kortare än 32 tecken (fail-closed; svag-
  secret-opt-in endast i dev/test bakom dubbel-gate).
- **SQL:** parametriserade frågor; dynamiska kolumnnamn allow-listas.
- **Beroenden:** `npm audit --audit-level=high` blockerar CI; Dependabot
  veckovis.

## Versioner som stöds

IT-Ticket driftas som **en instans per deployment** (ingen multi-tenancy) och
levereras rullande från `main`. Säkerhetsfixar landar på `main` — kör senaste
`main` för att vara skyddad. Det finns ingen separat LTS-gren.

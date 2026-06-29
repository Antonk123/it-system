# Bidra till IT-Ticket

Tack för att du vill bidra! Det här dokumentet beskriver hur du får upp en
utvecklingsmiljö, vilka kvalitetskrav som gäller och hur du skickar in ändringar.

## Förutsättningar

- **Node 22** (se [`.nvmrc`](.nvmrc))
- Docker + Docker Compose (för helhetskörning)
- Repot har **två** `package.json` — roten (frontend) och [`server/`](server/)
  (backend) — med separata beroenden och testsviter.

## Kom igång

```sh
git clone https://github.com/Antonk123/it-system.git
cd it-system

# Frontend-beroenden
npm ci
# Backend-beroenden
cd server && npm ci && cd ..

cp .env.example .env   # fyll i minst JWT_SECRET och CSRF_SECRET (≥32 tecken)
```

Kör hela stacken lokalt:

```sh
docker compose -f docker-compose.local.yml up --build
# Frontend: http://localhost:8082 · Backend: http://localhost:3002/api
```

Eller utveckla mot hot-reload (två terminaler):

```sh
npm run dev              # Vite (frontend)
cd server && npm run dev # tsx watch (backend)
```

## Kvalitetskrav (gates)

Alla måste passera lokalt **och** i CI innan en ändring mergas. Kör dem innan du
öppnar en PR:

| Var | Kommando | Vad |
|-----|----------|-----|
| rot | `npm run lint` | ESLint över hela repot |
| rot | `npx tsc --noEmit -p tsconfig.app.json && npx tsc --noEmit -p tsconfig.node.json` | Typecheck frontend |
| rot | `npm test` | Frontend-tester (vitest) |
| rot | `npm run build` | Prod-build |
| `server/` | `cd server && npx tsc --noEmit` | Typecheck backend |
| `server/` | `cd server && npm test` | Backend-tester (vitest) |

CI kör dessutom Docker-bygge av båda images och `npm audit --audit-level=high`
i båda beroendeträden.

> **Husky:** en pre-commit-hook kör `lint-staged` automatiskt. Använd **aldrig**
> `git commit --no-verify`.

## Kodkonventioner

- **API-anrop:** muterande anrop går via `api.request()` i `src/lib/api.ts`
  (hanterar CSRF-token, auth-header och 401-refresh). Rå `fetch('/api/...')` är
  **blockerad av ESLint** (`no-restricted-syntax`).
- **DB-migrations:** läggs in i `migrations`-arrayen i
  `server/src/db/migrations.ts` (körs av `runMigrations()` vid serverstart).
  Fristående `tsx`-script körs **inte** vid uppstart och appliceras aldrig i
  drift. Migrationer ska vara idempotenta (guarda med `columnExists`/
  `tableExists`) och `schema.sql` hållas i synk där relevant.
- **SQL:** alltid parametriserat. Dynamiska kolumnnamn ska allow-listas, aldrig
  interpoleras från klientinput.
- **Tester:** ny funktionalitet och buggfixar ska ha test. Projektet jobbar
  testdrivet — skriv testet först när det går.

## Commits & PR

- **Commit-meddelanden:** [Conventional Commits](https://www.conventionalcommits.org/)
  — t.ex. `feat(tickets): ...`, `fix(billing): ...`, `test(db): ...`,
  `ci: ...`, `docs: ...`.
- **Pull requests:** utgå från `main`, håll PR:n fokuserad, beskriv *vad* och
  *varför*. Länka relevant issue. Se till att alla gates ovan är gröna.
- En underhållare granskar och mergar. Större eller säkerhetskänsliga ändringar
  kan kräva extra granskning.

## Rapportera buggar & säkerhet

- **Buggar / funktioner:** öppna ett GitHub-issue med reproduktionssteg.
- **Säkerhetsbrister:** öppna **inte** ett publikt issue — följ
  [`SECURITY.md`](SECURITY.md).

# Runbook: Isolera dev-miljön (egen DB-volym + egen worktree)

**Mål:** Dev-stacken (`it-system-dev`, Portainer id 40) ska sluta dela prod-DB:n
(`it-ticketing-data`) och sluta sitta fast på `main`. Efteråt:

- Dev har **egen** DB-volym `it-ticketing-dev-data` (engångskopia av prod).
- Dev har **egen** checkout `/opt/it-system/itticket-dev` (git-worktree) — kan köra
  feature-grenen utan att störa prod-build-checkouten (`itticket-main` / `main`).

> **Bonus-fix:** Dev-backend är **nere just nu** (`curl :3003/api/health → 000`).
> Orsak: dev-stacken saknar `CSRF_SECRET`, och backend gör `process.exit(1)` utan den
> (server/src/index.ts:286-289, ovillkorligt — `tsx watch` håller containern "Up" men
> servern startar aldrig). Denna runbook lägger till `CSRF_SECRET` → dev-backend börjar
> faktiskt serva igen.

**Säkerhetsprinciper:**
- Prod-volymen (`it-ticketing-data`) mountas alltid **`:ro`** → kan fysiskt inte skadas.
- Seed tas från prods **redan färdiga nightly-backup-ZIP** (`backup-<datum>.zip`), som
  appen skapar på sin **live-connection** via `db.backup()` + `PRAGMA integrity_check`
  (server/src/index.ts:135-164). Inget eget `.backup()`-anrop mot live-DB:n, inget
  skrivande till prod-volymen.
- Prod-stacken (`it-ticket-system`, id 39) rörs **inte**.
- Claude kör aldrig container-livscykel — **alla kommandon nedan kör du (Anton)** via
  `ssh root@10.38.195.180`. `docker run --rm`/`docker exec` är engångs och skapar ingen
  stack som krockar med Portainer.

---

## 0. Förkontroll (read-only, ofarligt)

```bash
docker ps --format '{{.Names}}\t{{.Status}}' | grep ticket
docker volume ls | grep ticket                       # bör (ännu) bara visa it-ticketing-data
# Bekräfta att BÅDE prod och dev mountar prod-volymen idag (det vi ska bryta):
for c in it-ticketing-backend it-ticketing-backend-dev; do
  echo -n "$c: "; docker inspect "$c" --format '{{range .Mounts}}{{if eq .Name "it-ticketing-data"}}delar it-ticketing-data{{end}}{{end}}'; echo
done
# Senaste konsistenta seed-källa (ska finnas en färsk backup-*.zip):
ls -t /var/lib/docker/volumes/it-ticketing-data/_data/backups/backup-*.zip | head -1
df -h /opt | tail -1                                  # diskheadroom (worktree lägger ~tiotals MB)
```

> Vill du ha en FÄRSKARE seed än nattens 04:00-ZIP? Trigga en manuell backup i appen
> (admin → backup/download) innan steg 2 — den skapar en ny `backup-*.zip` på samma sätt.

## 1. Skapa dev-volymen

```bash
docker volume inspect it-ticketing-dev-data >/dev/null 2>&1 \
  && { echo "VARNING: it-ticketing-dev-data finns redan — seed i steg 2 skriver över den."; } \
  || docker volume create it-ticketing-dev-data
```

## 2. Seeda dev-volymen från prods nightly-ZIP (konsistent, prod ostörd, idempotent)

```bash
docker run --rm -v it-ticketing-data:/src:ro -v it-ticketing-dev-data:/dst alpine:3 sh -c '
  set -e
  apk add --no-cache unzip >/dev/null
  ZIP=$(ls -t /src/backups/backup-*.zip 2>/dev/null | head -1)
  [ -n "$ZIP" ] || { echo "FEL: ingen backup-*.zip i /src/backups"; exit 1; }
  echo "seedar dev från: $ZIP"
  # idempotent: rensa ev. tidigare seed innan kopiering (cp/mv-nesting undviks)
  rm -rf /dst/database.sqlite /dst/database.sqlite-wal /dst/database.sqlite-shm /dst/uploads /tmp/seed
  mkdir -p /tmp/seed
  unzip -q "$ZIP" -d /tmp/seed
  mv /tmp/seed/data/database.sqlite /dst/database.sqlite
  mv /tmp/seed/data/uploads        /dst/uploads
  rm -rf /tmp/seed
  echo "=== dev-volym efter seed ==="; ls -la /dst
'
```

Inget temp skrivs till prod-volymen, inget eget backup-anrop mot live-DB:n. ZIP:en mountas
read-only via prod-volymen.

### 2b. Verifiera seed-integritet (prod-imagen har better-sqlite3)

`.backup()`-DB:n **bär WAL-flaggan i headern**, så öppna den **RW** — en `:ro`-mount +
`readonly:true` ger `SQLITE_CANTOPEN` (SQLite kan inte skapa `-shm`). Den `--rm`-containern
skriver bara i dev-volymen, aldrig prod.

```bash
docker run --rm -v it-ticketing-dev-data:/dst --entrypoint node it-ticketing-backend:latest -e \
  "const D=require('better-sqlite3');const db=new D('/dst/database.sqlite');console.log('integrity:',db.pragma('integrity_check')[0].integrity_check);console.log('users:',db.prepare('SELECT count(*) c FROM users').get().c);console.log('tickets:',db.prepare('SELECT count(*) c FROM tickets').get().c);db.pragma('wal_checkpoint(TRUNCATE)');db.close()"
# förväntat: integrity: ok | users >= 2 | tickets > 0
# städa WAL-sidofiler så volymen är ren tills dev bootar:
docker run --rm -v it-ticketing-dev-data:/dst alpine:3 sh -c 'rm -f /dst/database.sqlite-wal /dst/database.sqlite-shm; echo "uploads: $(ls /dst/uploads | wc -l) filer"'
```

> Dev-backend återskapar `-wal`/`-shm` automatiskt vid första boot (connection.ts:20 sätter
> `journal_mode = WAL`) — att de saknas i dev-volymen direkt efter seed är **förväntat**.

## 3. Skapa dev-worktree (frikoppla dev-koden från prod-build-checkouten)

```bash
git -C /opt/it-system/itticket-main fetch origin
git -C /opt/it-system/itticket-main worktree add --detach /opt/it-system/itticket-dev origin/main
git -C /opt/it-system/itticket-main worktree list      # bekräfta båda
```

**Worktree-säkerhet (läs en gång):**
- `itticket-dev/.git` är en **pekarfil** in i `itticket-main/.git`. **Flytta/byt-namn/re-clona
  ALDRIG `itticket-main`** utan `git worktree move/remove` först — annars slutar dev fungera.
- Kör **all git i dev-worktree:n från HOSTEN** (`cd /opt/it-system/itticket-dev` via ssh),
  **aldrig** via `docker exec` — pekaren går till en host-sökväg som inte finns i containern.
- En gren kan bara vara utcheckad i **EN** worktree åt gången (det är en guardrail, inte ett fel).

**Workflow framåt — så testar du en gren i dev (hela poängen):**
```bash
cd /opt/it-system/itticket-dev
git fetch origin
git checkout <feature-branch>        # checkout FÖRST (detached-HEAD-pull misslyckas annars)
git pull --ff-only
# tsx watch + Vite hot-reloadar. INGEN image-rebuild. itticket-main/main påverkas inte.
```

## 4. Peka om dev-stacken i Portainer (id 40, "it-system-dev")

Portainer → **Stacks → it-system-dev → Editor**. Klistra in hela
`docker-compose.dev.portainer.yml` från repot (eller gör dessa exakta ändringar):

| Plats | Från | Till |
|-------|------|------|
| backend.volumes | `/opt/it-system/itticket-main:/app` | `/opt/it-system/itticket-dev:/app` |
| backend.volumes | `it-ticketing-data:/app/data` | `it-ticketing-dev-data:/app/data` |
| backend.environment | _(saknas)_ | **lägg till `CSRF_SECRET=${CSRF_SECRET}`** |
| frontend.volumes | `/opt/it-system/itticket-main:/app` | `/opt/it-system/itticket-dev:/app` |
| volumes-blocket | `it-ticketing-data` (external) | `it-ticketing-dev-data` (external, `name: it-ticketing-dev-data`) |

**Environment variables (Portainer-stacken) måste innehålla:** `JWT_SECRET`, **`CSRF_SECRET`**
(generera med `openssl rand -hex 64` om den saknas — dev-egen, inte prods), `CORS_ORIGIN`,
`ANTHROPIC_API_KEY`, ev. `AI_MONTHLY_TOKEN_LIMIT`, `VITE_API_URL`. → **"Update the stack"** (recreate).

> Efter en stor dependency-ändring på en feature-gren: om dev beter sig konstigt, recreate
> stacken (färska node_modules-volymer) eller `docker exec it-ticketing-backend-dev sh -c 'cd /app/server && npm ci'`.

## 5. Verifiera (bevis innan klar — bidirektionell isolering)

```bash
# (a) Dev mountar nu DEV-volymen + dev-worktree, INTE prod — assertion som failar högt:
docker inspect it-ticketing-backend-dev --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}' \
  | grep -q 'it-ticketing-dev-data' && echo "OK: dev på dev-volym" || echo "FEL: dev INTE på dev-volym"
docker inspect it-ticketing-backend-dev --format '{{range .Mounts}}{{.Source}}{{println}}{{end}}' \
  | grep -q '/it-ticketing-data/' && echo "FEL: dev rör fortf. prod-volym!" || echo "OK: dev rör ej prod-volym"

# (b) Prod OFÖRÄNDRAD + ingen container delar prod-volymen med dev längre (ska bara lista prod):
for c in $(docker ps --format '{{.Names}}'); do
  docker inspect "$c" --format '{{range .Mounts}}{{if eq .Name "it-ticketing-data"}}'"$c"' -> it-ticketing-data{{println}}{{end}}{{end}}'
done

# (c) Dev-backend SERVAR nu (var 000 innan fixen):
curl -s -o /dev/null -w 'dev :3003 -> %{http_code}\n' --max-time 5 http://10.38.195.180:3003/api/health
docker logs --tail 30 it-ticketing-backend-dev      # "Server running", inga FATAL/migration-fel

# (d) Bidirektionell isolering — räkna via de KÖRANDE containrarnas egna connections
#     (RW-mount → inga :ro/WAL-problem):
docker exec it-ticketing-backend     node -e "const D=require('better-sqlite3');console.log('prod tickets:',new D(process.env.DB_PATH,{readonly:true}).prepare('SELECT count(*) c FROM tickets').get().c)"
docker exec it-ticketing-backend-dev node -e "const D=require('better-sqlite3');console.log('dev tickets:',new D(process.env.DB_PATH,{readonly:true}).prepare('SELECT count(*) c FROM tickets').get().c)"
# Skapa sedan ett ärende i dev (:5174) → kör om → dev ökar, prod står still.
```

Logga in på <http://10.38.195.180:5174> med **samma konton som prod** (DB:n är kopierad) och
kontrollera att en bifogad fil (attachment) öppnas (bevisar att uploads kopierades läsbart).

---

## Rollback (rätt ordning — annars "volume is in use")

```bash
# 1. Portainer: recreate stack 40 tillbaka till it-ticketing-data + /opt/it-system/itticket-main.
#    BEHÅLL CSRF_SECRET i env (annars bootar inte ens den rollbackade dev-stacken).
# 2. FÖRST när ingen container mountar dev-volymen:
docker volume rm it-ticketing-dev-data
# 3. Ta bort worktree:
git -C /opt/it-system/itticket-main worktree remove --force /opt/it-system/itticket-dev
```

Prod-DB:n (`it-ticketing-data`) rörs aldrig destruktivt — all läsning är `:ro`, och seed
kommer från en redan färdig, integritetskontrollerad backup-ZIP (inget skrivs till prod-volymen).

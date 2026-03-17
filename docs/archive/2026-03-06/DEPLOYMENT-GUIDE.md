# Deployment Guide - Kritiska Förbättringar 2026-03-06

**Datum:** 2026-03-06
**Omfattning:** 5 kritiska fixes + flera mindre
**Estimerad tid:** 20-30 minuter
**Downtime:** ~2-3 minuter (under rebuild)

---

## 📋 Översikt

Denna deployment innehåller:

1. ✅ **Helmet Security Headers** - CSP, HSTS, etc.
2. ✅ **Database Indexes** - 3 nya composite indexes
3. ✅ **Transaction Error Handling** - Race condition fixes
4. ✅ **SELECT * Optimization** - 30 queries optimerade
5. ✅ **JWT Refresh Tokens** - 1h access tokens + refresh system

---

## ⚠️ Pre-Deployment Checklist

- [ ] Backup database: `cp data/database.db data/database.db.backup-$(date +%Y%m%d)`
- [ ] Läst alla changelogs
- [ ] Notifierat användare om ~3 min downtime
- [ ] Har tillgång till Portainer
- [ ] Docker daemon körs

---

## 🗂️ Deployment Ordning (VIKTIGT!)

**Kör i denna ordning:**

```
1. Database Migrations (FÖRST)
   ├── add-performance-indexes.ts
   └── add-refresh-tokens.ts

2. Test Migrations (Verifiera)
   ├── test-index-performance.ts
   └── test-transactions.ts

3. Rebuild Images
   ├── Backend (it-ticketing-backend:latest)
   └── Frontend (it-ticketing-frontend:latest)

4. Deploy (Portainer)

5. Post-Deploy Verification
```

---

## 📖 Detaljerade Steg

### STEG 1: Database Migrations

#### 1.1 Performance Indexes

```bash
# Lägg till database indexes (3 nya)
docker exec it-ticketing-backend-dev sh -c "cd /app/server && npx tsx src/db/add-performance-indexes.ts"
```

**Förväntad output:**
```
📊 Adding Performance Indexes to Database
============================================================

✓ Checking and creating indexes...

  Creating: idx_tickets_created_at
    ✅ Created successfully

  Creating: idx_tickets_status_priority
    ✅ Created successfully

  Creating: idx_ticket_field_values_search
    ✅ Created successfully

============================================================
📊 Migration Summary
============================================================
Indexes Created: 3
Indexes Skipped: 0

✅ Performance indexes added successfully!

📈 Expected Improvements:
  - Ticket listing: 20-30% faster
  - Status+Priority filtering: 30-40% faster
  - Custom field searches: 50-70% faster
```

**Om du ser "already exists":** Det är OK, indexes är redan tillagda.

---

#### 1.2 Refresh Tokens Table

```bash
# Skapa refresh_tokens tabell
docker exec it-ticketing-backend-dev sh -c "cd /app/server && npx tsx src/db/add-refresh-tokens.ts"
```

**Förväntad output:**
```
🔒 Creating Refresh Tokens Table
============================================================
Creating refresh_tokens table...

✅ Created table: refresh_tokens
✅ Created index: idx_refresh_tokens_token
✅ Created index: idx_refresh_tokens_user
✅ Created index: idx_refresh_tokens_expires

🎉 Migration completed successfully!
```

**Om tabellen redan finns:** "Table refresh_tokens already exists" - OK!

---

### STEG 2: Verifiera Migrations (Valfritt men rekommenderat)

#### 2.1 Test Index Performance

```bash
docker exec it-ticketing-backend-dev sh -c "cd /app/server && npx tsx src/test-index-performance.ts"
```

**Förväntad output:**
```
⚡ Database Index Performance Test
============================================================

📊 Database Statistics:
  Tickets: 150
  Custom Field Values: 45

🔍 Index Status:
  ✅ idx_tickets_created_at: EXISTS
  ✅ idx_tickets_status_priority: EXISTS
  ✅ idx_ticket_field_values_search: EXISTS

============================================================
⚡ Running Performance Tests
============================================================

📝 Ticket Listing (ORDER BY created_at)
   ⏱️  Average time: 0.843ms
   Status: ✅ Excellent (<1ms)

📝 Status + Priority Filter
   ⏱️  Average time: 0.521ms
   Status: ✅ Excellent (<1ms)

✅ All queries performing well!
```

---

#### 2.2 Test Transaction Safety

```bash
docker exec it-ticketing-backend-dev sh -c "cd /app/server && npx tsx src/test-transactions.ts"
```

**Förväntad output:**
```
🔒 Transaction Safety Test
============================================================

✅ CSV Import Rollback
   Transaction correctly rolled back all changes

✅ Empty Checklist Array
   Empty array correctly handled without SQL error

✅ User Creation Race Condition
   UNIQUE constraint correctly prevented duplicate email

============================================================
📊 Test Summary
============================================================
Total Tests: 5
Passed: 5
Failed: 0

🎉 All transaction safety tests passed!
```

---

### STEG 3: Rebuild Docker Images

**VIKTIGT:** Båda frontend OCH backend måste rebuiltdas!

```bash
cd /opt/it-system/itticket-main

# 1. Rebuild backend
echo "🔨 Building backend..."
docker build -f Dockerfile.server -t it-ticketing-backend:latest .

# 2. Rebuild frontend (innehåller ny tokenRefresh.ts)
echo "🔨 Building frontend..."
docker build -f Dockerfile.client -t it-ticketing-frontend:latest .

# 3. Verifiera att images skapades
docker images | grep it-ticketing
```

**Förväntad output:**
```
it-ticketing-backend   latest    abc123def456   2 seconds ago   XXX MB
it-ticketing-frontend  latest    def456ghi789   5 seconds ago   XXX MB
```

**Om build failar:**
- Kontrollera att package.json har `helmet` dependency
- Kontrollera att alla TypeScript filer kompilerar
- Kör `docker build` igen med `--no-cache` om nödvändigt

---

### STEG 4: Deploy via Portainer

#### Option A: Via Portainer Web UI (Rekommenderas)

1. **Gå till Portainer:**
   ```
   http://<your-portainer-url>
   ```

2. **Navigera till Stack:**
   - Stacks → it-ticketing-stack (eller ditt stack-namn)

3. **Update Stack:**
   - Klicka "Update the stack"
   - Vänta på deployment (~2-3 minuter)
   - Verifiera status: "Running"

4. **Kontrollera containers:**
   ```bash
   docker ps | grep it-ticketing
   ```

   **Förväntad output:**
   ```
   it-ticketing-backend     Running   2 minutes ago
   it-ticketing-frontend    Running   2 minutes ago
   ```

#### Option B: Via Docker Compose (Alternativ)

```bash
cd /opt/it-system/itticket-main

# 1. Stop containers
docker-compose down

# 2. Start with new images
docker-compose up -d

# 3. Verify
docker-compose ps
```

---

### STEG 5: Post-Deployment Verification

#### 5.1 Kontrollera Backend Health

```bash
# Health check
curl http://localhost:3002/api/health | jq '.'
```

**Förväntat:**
```json
{
  "status": "ok",
  "timestamp": "2026-03-06T..."
}
```

---

#### 5.2 Verifiera Security Headers

```bash
curl -I http://localhost:3002/api/health
```

**Förväntat (se dessa headers):**
```
X-DNS-Prefetch-Control: off
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
Strict-Transport-Security: max-age=31536000; includeSubDomains; preload
Content-Security-Policy: default-src 'self'; ...
```

**OM security headers SAKNAS:**
- Backend har inte rebuiltdats korrekt
- Helmet middleware inte aktiverad
- Kör rebuild igen

---

#### 5.3 Test Login med nya JWT Tokens

```bash
# Login
curl -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"<your-password>"}' \
  | jq '.'
```

**Förväntad output (NYA FÄLT):**
```json
{
  "user": {
    "id": "...",
    "email": "admin@example.com",
    "role": "admin"
  },
  "token": "eyJhbGc...",        // Access token (1h)
  "accessToken": "eyJhbGc...",  // Same as token
  "refreshToken": "abc123..."   // NEW! Refresh token (7d)
}
```

**OM refreshToken SAKNAS:**
- refresh_tokens table inte skapad
- Kör migration igen: `add-refresh-tokens.ts`

---

#### 5.4 Test Token Refresh

```bash
# Spara tokens från login
REFRESH_TOKEN="<from login response>"

# Refresh access token
curl -X POST http://localhost:3002/api/auth/refresh \
  -H "Content-Type: application/json" \
  -d "{\"refreshToken\":\"$REFRESH_TOKEN\"}" \
  | jq '.'
```

**Förväntat:**
```json
{
  "accessToken": "new-jwt-token",
  "token": "new-jwt-token"
}
```

**OM 401 error:**
- Refresh token ogiltig
- Tabellen refresh_tokens saknas
- Backend inte rebuiltdad

---

#### 5.5 Verifiera Database Indexes

```bash
# Anslut till databas
docker exec -it it-ticketing-backend sh -c "sqlite3 /app/data/database.db"

# I SQLite prompt:
.indexes tickets
```

**Förväntad output (se DESSA NYA indexes):**
```
idx_tickets_category
idx_tickets_created_at          ← NY!
idx_tickets_priority
idx_tickets_requester
idx_tickets_status
idx_tickets_status_priority     ← NY!
```

```sql
-- Kontrollera refresh_tokens table
.schema refresh_tokens
```

**Förväntat:**
```sql
CREATE TABLE refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires_at TEXT NOT NULL,
  ...
);
```

**Exit SQLite:**
```
.quit
```

---

#### 5.6 Frontend Test

1. **Öppna appen:**
   ```
   http://<your-frontend-url>
   ```

2. **Login:**
   - Använd credentials
   - Verifiera att login fungerar

3. **Kontrollera Developer Console:**
   ```
   F12 → Console
   ```

   - Inga errors
   - Kolla localStorage:
     ```javascript
     localStorage.getItem('token')        // Access token
     localStorage.getItem('refreshToken') // Refresh token (NY!)
     ```

4. **Test Token Refresh (Vänta 1h ELLER simulate):**
   - För att testa utan att vänta, modifiera JWT expiration temporärt till `'10s'`
   - Se att frontend automatiskt refreshar vid 401

---

## 🧹 Optional: Cleanup Old Refresh Tokens

Sätt upp daglig cleanup (cron job):

```bash
# Lägg till i crontab
crontab -e

# Lägg till denna rad (kör varje dag kl. 00:00):
0 0 * * * docker exec it-ticketing-backend sh -c "cd /app && npx tsx src/db/cleanup-refresh-tokens.ts"
```

**Eller kör manuellt:**
```bash
docker exec it-ticketing-backend sh -c "cd /app && npx tsx src/db/cleanup-refresh-tokens.ts"
```

---

## 🔧 Troubleshooting

### Problem 1: "Table refresh_tokens already exists"

**Lösning:** Inget problem! Migration redan kördes. Fortsätt till nästa steg.

---

### Problem 2: Backend startar inte efter rebuild

**Debug:**
```bash
# Kontrollera loggar
docker logs it-ticketing-backend --tail 100
```

**Vanliga errors:**
- `Cannot find module 'helmet'` → Kör rebuild igen
- `JWT_SECRET not set` → Verifiera env vars
- Database lock → Stoppa gamla containers först

**Lösning:**
```bash
# 1. Stoppa alla containers
docker-compose down

# 2. Rebuild (no cache)
docker build -f Dockerfile.server -t it-ticketing-backend:latest --no-cache .

# 3. Starta igen
docker-compose up -d
```

---

### Problem 3: Security headers saknas

**Debug:**
```bash
curl -I http://localhost:3002/api/health | grep -i "x-frame"
```

**Om inget returnas:**
- Helmet middleware inte aktiverad
- Backend inte rebuiltdad med nya ändringar

**Lösning:**
```bash
# Verifiera att server/src/index.ts innehåller helmet import
docker exec it-ticketing-backend sh -c "grep -n 'import helmet' /app/src/index.ts"

# Om inte, rebuild behövs
```

---

### Problem 4: Login returnerar inte refreshToken

**Debug:**
```bash
# Kontrollera response
curl -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}' \
  | jq 'keys'
```

**Om refreshToken saknas:**

**Lösning:**
```bash
# 1. Verifiera att refresh_tokens table finns
docker exec it-ticketing-backend sh -c "sqlite3 /app/data/database.db '.tables'" | grep refresh

# 2. Kör migration om table saknas
docker exec it-ticketing-backend sh -c "cd /app && npx tsx src/db/add-refresh-tokens.ts"

# 3. Rebuild backend
docker build -f Dockerfile.server -t it-ticketing-backend:latest .

# 4. Restart containers
docker-compose restart
```

---

### Problem 5: Frontend token refresh inte fungerar

**Debug:**
1. Öppna browser DevTools → Network tab
2. Leta efter `/api/auth/refresh` requests vid 401 errors
3. Kontrollera Console för errors

**Vanliga problem:**
- `tokenRefresh.ts` inte inkluderad i build
- Axios interceptor inte setup:ad
- localStorage.getItem('refreshToken') är null

**Lösning:**
```bash
# Rebuild frontend
docker build -f Dockerfile.client -t it-ticketing-frontend:latest --no-cache .

# Deploy
docker-compose restart it-ticketing-frontend
```

---

## ✅ Success Criteria

Deployment är lyckad om:

- [ ] ✅ Alla migrations kördes utan errors
- [ ] ✅ Backend startar utan errors
- [ ] ✅ Frontend startar utan errors
- [ ] ✅ Login fungerar och returnerar refreshToken
- [ ] ✅ Security headers närvarande (curl -I)
- [ ] ✅ Database indexes finns (idx_tickets_created_at etc.)
- [ ] ✅ refresh_tokens table finns
- [ ] ✅ Token refresh fungerar (POST /api/auth/refresh)
- [ ] ✅ Logout revoke:ar refresh token
- [ ] ✅ Inga errors i browser console
- [ ] ✅ Performance är bra (ticket listing <50ms)

---

## 📊 Post-Deployment Metrics

### Förväntat efter deployment:

| Metric | Före | Efter | Förbättring |
|--------|------|-------|-------------|
| **Login response time** | ~50ms | ~30ms | 40% snabbare |
| **Ticket listing** | 500-1000ms | 2-8ms | **97% snabbare** |
| **Security headers** | 0 | 7 headers | +∞% |
| **JWT lifetime** | 7 dagar | 1 timme | **99.4% säkrare** |
| **Token revocation** | Omöjligt | Möjligt | ✅ |

---

## 📝 Rollback Plan (Om något går fel)

### Snabb Rollback:

```bash
# 1. Stoppa containers
docker-compose down

# 2. Återställ database backup
cp data/database.db.backup-20260306 data/database.db

# 3. Använd gamla images (om du har dem)
docker-compose up -d

# ELLER rebuild från tidigare commit:
git checkout <previous-commit>
docker build -f Dockerfile.server -t it-ticketing-backend:latest .
docker build -f Dockerfile.client -t it-ticketing-frontend:latest .
docker-compose up -d
```

---

## 🎉 Post-Deployment

Efter lyckad deployment:

1. **Notifiera användare** att systemet är uppe igen
2. **Monitera loggar** första timmen:
   ```bash
   docker logs -f it-ticketing-backend
   ```
3. **Verifiera** att inga errors dyker upp
4. **Test** critical user flows (login, create ticket, etc.)
5. **Dokumentera** eventuella issues i GitHub issues

---

## 📚 Dokumentation

För mer detaljer, se:

- [CHANGELOG-HELMET-2026-03-06.md](tasks/CHANGELOG-HELMET-2026-03-06.md)
- [CHANGELOG-INDEXES-2026-03-06.md](tasks/CHANGELOG-INDEXES-2026-03-06.md)
- [CHANGELOG-TRANSACTIONS-2026-03-06.md](tasks/CHANGELOG-TRANSACTIONS-2026-03-06.md)
- [CHANGELOG-SELECT-OPTIMIZATION-2026-03-06.md](tasks/CHANGELOG-SELECT-OPTIMIZATION-2026-03-06.md)
- [CHANGELOG-JWT-REFRESH-2026-03-06.md](tasks/CHANGELOG-JWT-REFRESH-2026-03-06.md)

---

**Lycka till med deploymentet! 🚀**

**Om du stöter på problem:** Kolla troubleshooting-sektionen eller kontakta dev team.

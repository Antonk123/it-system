**Status:** 🟢 Aktiv  
**Placering:** Proxmox Docker (Portainer)  
**Senast uppdaterad:** 2025-01-17

---

## Grundinformation

| Parameter | Värde |
|-----------|-------|
| **Funktion** | IT-ärendehantering |
| **Container** | it-ticketing-backend, it-ticketing-frontend |
| **Web UI** | http://10.38.195.180:8082 |
| **API** | http://10.38.195.180:3002/api |
| **Databas** | SQLite (Docker volume: `it-ticketing-data`) |

---

## Förutsättningar

- Docker + Portainer är installerat och fungerar
- Repo finns på Docker-hosten: `/opt/it-system/itticket-main`
- Portar är lediga: `8082` (frontend) och `3002` (backend)
- DNS/host är känd (t.ex. `10.38.195.180` eller domän)

---

## Skapa volymer och nätverk

### 1) Skapa datavolym (engångs)
```bash
docker volume create it-ticketing-data
```

### 2) Skapa nätverk (valfritt)
Portainer skapar nätverk automatiskt, men du kan skapa det manuellt:
```bash
docker network create ticketing
```

---

## Docker Compose Stack (Prod)

```yaml
version: "3.8"

services:
  backend:
    image: it-ticketing-backend:latest
    container_name: it-ticketing-backend
    restart: unless-stopped
    ports:
      - "3002:3001"
    volumes:
      - it-ticketing-data:/app/data
    environment:
      - NODE_ENV=production
      - JWT_SECRET=<SET_I_PORTAINER_ENV>
      - DB_PATH=/app/data/database.sqlite
      - UPLOAD_DIR=/app/data/uploads
      - SMTP_HOST=smtp.office365.com
      - SMTP_PORT=587
      - SMTP_USER=<SET_I_PORTAINER_ENV>
      - SMTP_PASS=<SET_I_PORTAINER_ENV>
      - EMAIL_FROM=noreply@prefabmastarna.se
      - EMAIL_TO=it@prefabmastarna.se
      - APP_BASE_URL=http://10.38.195.180:8082
    networks:
      - ticketing

  frontend:
    image: it-ticketing-frontend:latest
    container_name: it-ticketing-frontend
    restart: unless-stopped
    ports:
      - "8082:80"
    depends_on:
      - backend
    networks:
      - ticketing

networks:
  ticketing:
    driver: bridge

volumes:
  it-ticketing-data:
    external: true
```

---

## Deploy från grunden (Portainer)

### 1) Bygg images på Docker-hosten
Kör på servern där Docker körs:

```bash
docker build -f Dockerfile.server -t it-ticketing-backend:latest .
docker build -f Dockerfile.client -t it-ticketing-frontend:latest --build-arg VITE_API_URL=/api .
```

### 2) Skapa Stack i Portainer
1. Portainer → **Stacks** → **Add stack**
2. Namn: `it-ticketing-system`
3. Klistra in compose-filen ovan
4. Sätt environment-variabeln `JWT_SECRET`
5. **Deploy**

✅ Databasen påverkas inte av deploy (volymen ligger kvar).

---

## Efter deploy (verifiering)

### Kontrollera containers
- Portainer → Containers → båda ska vara **running**

### Testa endpoints
```bash
curl http://10.38.195.180:3002/api/health
```
Öppna UI:
```
http://10.38.195.180:8082
```

---

## Uppdatera (redeploy)

1. Bygg images (samma kommandon som ovan)
2. Portainer → **Stacks** → välj prod-stack
3. **Update the stack**
4. Avmarkera **Pull latest image**
5. **Deploy**

### Snabb uppdatering (säker för volymen)
Detta påverkar inte `it-ticketing-data`-volymen.

```bash
# Frontend (krävs för UI-ändringar)
docker build -f Dockerfile.client -t it-ticketing-frontend:latest --build-arg VITE_API_URL=/api .

# Backend (endast om serverkod ändrats)
docker build -f Dockerfile.server -t it-ticketing-backend:latest .
```

Sedan: Portainer → **Stacks** → **Update the stack** → **Deploy** (utan **Pull latest image**).

### Miljövariabler via .env (rekommenderat)
Lägg .env utanför repo, t.ex. /opt/it-system/itticket-prod.env, och peka Portainer-stacken till den filen (Env file).
Filen ska inte checkas in i Git.


✅ Databasen påverkas inte av redeploy.

---

## Dev-miljö (Portainer)

Om du vill köra dev parallellt med prod:
- Använd `docker-compose.dev.portainer.yml`
- Frontend: `5174`
- Backend: `3003`
- Samma datavolym om du vill dela data med prod

---

## Felsökning

### Fel: container name already in use
Om Portainer säger att namnet är upptaget:

```bash
docker rm -f it-ticketing-backend it-ticketing-frontend
```

Kör sedan **Update the stack** igen i Portainer.

---

## Backup

✅ Data ligger i Docker-volymen `it-ticketing-data`

### Snabb backup (host)
```bash
docker volume inspect it-ticketing-data
```
Hitta `Mountpoint` och kopiera `database.sqlite` därifrån.

### Backup via tillfällig container
```bash
docker run --rm -v it-ticketing-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/it-ticketing-backup-$(date +%Y%m%d).tar.gz /data
```

### Återställning
```bash
docker run --rm -v it-ticketing-data:/data -v $(pwd):/backup alpine \
  tar xzf /backup/it-ticketing-backup-YYYYMMDD.tar.gz -C /
```

---

## Databasmigreringar

Om du ändrar databas‑schema (t.ex. nya statusar) kan SQLite behöva en migration som också uppdaterar foreign keys. Kör alltid backup innan migration och testa i dev om möjligt.

---

## Relaterade Sidor

- [Portainer - Container Management](Portainer)
- [Proxmox - Virtual Environment](Proxmox)

#!/bin/bash
# IT Ticket System - Setup-script
# Klonar repot och sätter upp ett färdigt system från grunden.
#
# Kör med:
#   bash <(curl -fsSL https://raw.githubusercontent.com/Antonk123/it-system/main/setup.sh)
# Eller lokalt:
#   bash setup.sh

set -e

# --- Konfiguration (uppdatera REPO_URL innan publicering) ---
REPO_URL="https://github.com/Antonk123/it-system"
INSTALL_DIR="/opt/it-ticketing"

# --- Färger ---
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
BOLD='\033[1m'
NC='\033[0m'

ok()     { echo -e "  ${GREEN}✓${NC} $1"; }
err()    { echo -e "  ${RED}✗${NC} $1"; exit 1; }
info()   { echo -e "  ${BLUE}→${NC} $1"; }
warn()   { echo -e "  ${YELLOW}!${NC} $1"; }
header() { echo -e "\n${BOLD}${BLUE}=== $1 ===${NC}\n"; }

echo -e "\n${BOLD}IT Ticket System — Installationsguide${NC}"
echo "  ─────────────────────────────────────"

# --- 1. Kontrollera förutsättningar ---
header "Kontrollerar förutsättningar"

command -v docker   &>/dev/null || err "Docker är inte installerat. Se https://docs.docker.com/get-docker/"
ok "Docker: $(docker --version | cut -d' ' -f3 | tr -d ',')"

docker compose version &>/dev/null || err "Docker Compose v2 saknas. Se https://docs.docker.com/compose/install/"
ok "Docker Compose: $(docker compose version --short)"

if ! command -v git &>/dev/null; then
  info "git saknas — installerar..."
  sudo apt-get install -y git -qq
fi
ok "git: $(git --version | cut -d' ' -f3)"

if ! command -v curl &>/dev/null; then
  info "curl saknas — installerar..."
  sudo apt-get install -y curl -qq
fi
ok "curl hittades"

if ! command -v openssl &>/dev/null; then
  info "openssl saknas — installerar..."
  sudo apt-get install -y openssl -qq
fi
ok "openssl hittades"

# --- 2. Klona eller uppdatera repot ---
header "Hämtar källkod"

if [ -d "$INSTALL_DIR/.git" ]; then
  info "Katalog finns redan — uppdaterar ($INSTALL_DIR)"
  git -C "$INSTALL_DIR" pull --quiet
  ok "Repo uppdaterat"
else
  info "Klonar $REPO_URL → $INSTALL_DIR"
  git clone --quiet "$REPO_URL" "$INSTALL_DIR"
  ok "Repo klonat"
fi

cd "$INSTALL_DIR"

# --- 2b. Disconnecta GitHub ---
git remote remove origin
info "GitHub-kopplingen borttagen — systemet är nu lokalt"

# --- 3. Konfiguration ---
header "Företagsinformation"

read -rp "  Företagsnamn: " COMPANY_NAME </dev/tty
if [ -z "$COMPANY_NAME" ]; then
  err "Företagsnamn krävs."
fi

read -rp "  Admin-namn [IT-administratör]: " ADMIN_NAME </dev/tty
ADMIN_NAME=${ADMIN_NAME:-IT-administratör}

read -rp "  Admin e-post: " ADMIN_EMAIL </dev/tty
if [ -z "$ADMIN_EMAIL" ]; then
  err "Admin e-post krävs."
fi

read -rsp "  Admin lösenord (minst 12 tecken, versal+gemen+siffra+specialtecken): " ADMIN_PASSWORD </dev/tty
echo ""
if [ ${#ADMIN_PASSWORD} -lt 12 ]; then
  err "Lösenordet måste vara minst 12 tecken."
fi
if ! echo "$ADMIN_PASSWORD" | grep -qP '(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])'; then
  err "Lösenordet måste innehålla minst en versal, en gemen, en siffra och ett specialtecken (@\$!%*?&)"
fi

header "Nätverkskonfiguration"
echo -e "  Tryck ${BOLD}Enter${NC} för att använda standardvärden (visas i [hakparentes])\n"

read -rp "  Frontend-port [8082]: " FRONTEND_PORT </dev/tty
FRONTEND_PORT=${FRONTEND_PORT:-8082}

read -rp "  Backend-port [3002]: " BACKEND_PORT </dev/tty
BACKEND_PORT=${BACKEND_PORT:-3002}

DEFAULT_URL="http://localhost:${FRONTEND_PORT}"
read -rp "  App-URL (för CORS och e-postlänkar) [${DEFAULT_URL}]: " APP_URL </dev/tty
APP_URL=${APP_URL:-$DEFAULT_URL}
if [[ ! "$APP_URL" =~ ^https?:// ]]; then
  APP_URL="http://$APP_URL"
  info "Protokoll saknades — lade till automatiskt: $APP_URL"
fi

# --- 3b. Detektera maskinens IP för CORS ---
DETECTED_IP=$(hostname -I | awk '{print $1}' | tr -d '[:space:]')
if [ -n "$DETECTED_IP" ] && [ "$DETECTED_IP" != "127.0.0.1" ]; then
  CORS_ORIGINS="${APP_URL},http://${DETECTED_IP}:${FRONTEND_PORT}"
  info "Detekterad IP: ${DETECTED_IP} — CORS tillåter både URL:en och ${DETECTED_IP}"
else
  CORS_ORIGINS="${APP_URL}"
fi

header "AI-konfiguration"
echo -e "  AI-funktioner kräver en Anthropic API-nyckel."
echo -e "  Hämta din nyckel på ${BOLD}https://console.anthropic.com/keys${NC}\n"

read -rp "  Anthropic API-nyckel (tryck Enter för att hoppa över): " ANTHROPIC_API_KEY </dev/tty
if [ -n "$ANTHROPIC_API_KEY" ]; then
  ok "API-nyckel sparad — AI-funktioner aktiverade"
else
  warn "Ingen API-nyckel — AI-funktioner inaktiverade (kan läggas till i .env senare)"
fi

header "SMTP-konfiguration (valfritt)"
echo -e "  Krävs för e-postnotifieringar. Tryck ${BOLD}Enter${NC} för att hoppa över.\n"

read -rp "  SMTP-server: " SMTP_HOST </dev/tty
if [ -n "$SMTP_HOST" ]; then
  read -rp "  SMTP-port [587]: " SMTP_PORT </dev/tty
  SMTP_PORT=${SMTP_PORT:-587}
  read -rp "  SMTP-användare: " SMTP_USER </dev/tty
  read -rsp "  SMTP-lösenord: " SMTP_PASS </dev/tty
  echo ""
  read -rp "  E-post från (avsändare): " EMAIL_FROM </dev/tty
  read -rp "  E-post till (notifieringar skickas hit): " EMAIL_TO </dev/tty
else
  SMTP_PORT=587
  SMTP_USER=""
  SMTP_PASS=""
  EMAIL_FROM=""
  EMAIL_TO=""
  info "SMTP hoppas över — e-postnotifieringar inaktiverade"
fi

# --- 4. Generera hemligheter ---
JWT_SECRET=$(openssl rand -base64 32)
ok "JWT_SECRET genererad"

CSRF_SECRET=$(openssl rand -base64 32)
ok "CSRF_SECRET genererad"

# VAPID-nycklar för push-notiser (kräver Node)
if command -v node &>/dev/null; then
  VAPID_KEYS=$(node -e "
    try {
      const wpp = require('web-push');
      const k = wpp.generateVAPIDKeys();
      console.log(k.publicKey + ':' + k.privateKey);
    } catch(e) { console.log(''); }
  " 2>/dev/null)
  if [ -n "$VAPID_KEYS" ]; then
    VAPID_PUBLIC_KEY="${VAPID_KEYS%%:*}"
    VAPID_PRIVATE_KEY="${VAPID_KEYS##*:}"
    ok "VAPID-nycklar genererade (push-notiser aktiverade)"
  else
    VAPID_PUBLIC_KEY=""
    VAPID_PRIVATE_KEY=""
    warn "web-push ej tillgängligt — push-notiser inaktiverade (kan genereras senare)"
  fi
else
  VAPID_PUBLIC_KEY=""
  VAPID_PRIVATE_KEY=""
  warn "Node.js ej tillgängligt lokalt — VAPID-nycklar genereras inte"
fi

# --- 5. Skriv .env ---
cat > .env << EOF
# Genererat av setup.sh $(date +%Y-%m-%d\ %H:%M)
# ${COMPANY_NAME}

# --- Nätverk ---
FRONTEND_PORT=${FRONTEND_PORT}
BACKEND_PORT=${BACKEND_PORT}
CORS_ORIGIN=${CORS_ORIGINS}
APP_BASE_URL=${APP_URL}

# --- Varumärke ---
BRAND_NAME=${COMPANY_NAME}

# --- Admin ---
ADMIN_EMAIL=${ADMIN_EMAIL}
ADMIN_PASSWORD=${ADMIN_PASSWORD}
ADMIN_NAME=${ADMIN_NAME}

# --- Säkerhet ---
JWT_SECRET=${JWT_SECRET}
CSRF_SECRET=${CSRF_SECRET}

# --- Push-notiser (VAPID) ---
VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY:-}
VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY:-}
VAPID_SUBJECT=mailto:${ADMIN_EMAIL}

# --- AI (Anthropic) ---
ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
AI_MODEL=claude-haiku-4-5-20251001
AI_MODEL_SMART=

# --- E-post ---
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
EMAIL_FROM=${EMAIL_FROM}
EMAIL_TO=${EMAIL_TO}
EOF
ok ".env skapad"

# --- 5b. Generera docker-compose.local.yml ---
cat > docker-compose.local.yml << 'COMPOSE_EOF'
services:
  backend:
    image: it-ticketing-backend:latest
    container_name: it-ticketing-backend
    restart: unless-stopped
    ports:
      - "${BACKEND_PORT:-3002}:3001"
    volumes:
      - it-ticketing-data:/app/data
    environment:
      - NODE_ENV=production
      - COOKIE_SECURE=${COOKIE_SECURE:-false}
      - JWT_SECRET=${JWT_SECRET}
      - CSRF_SECRET=${CSRF_SECRET}
      - DB_PATH=/app/data/database.sqlite
      - UPLOAD_DIR=/app/data/uploads
      - ADMIN_EMAIL=${ADMIN_EMAIL:-}
      - ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
      - ADMIN_NAME=${ADMIN_NAME:-}
      - BRAND_NAME=${BRAND_NAME:-IT-Support}
      - AUTO_CLOSE_DAYS=${AUTO_CLOSE_DAYS:-30}
      - BACKUP_RETENTION_DAYS=${BACKUP_RETENTION_DAYS:-7}
      - CORS_ORIGIN=${CORS_ORIGIN}
      - APP_BASE_URL=${APP_BASE_URL}
      - VAPID_PUBLIC_KEY=${VAPID_PUBLIC_KEY:-}
      - VAPID_PRIVATE_KEY=${VAPID_PRIVATE_KEY:-}
      - VAPID_SUBJECT=${VAPID_SUBJECT:-}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY:-}
      - AI_MODEL=${AI_MODEL:-}
      - AI_MODEL_SMART=${AI_MODEL_SMART:-}
      - AI_MAX_SUMMARY_COMMENTS=${AI_MAX_SUMMARY_COMMENTS:-}
      - AI_MONTHLY_TOKEN_LIMIT=${AI_MONTHLY_TOKEN_LIMIT:-}
      - SMTP_HOST=${SMTP_HOST:-}
      - SMTP_PORT=${SMTP_PORT:-587}
      - SMTP_USER=${SMTP_USER:-}
      - SMTP_PASS=${SMTP_PASS:-}
      - EMAIL_FROM=${EMAIL_FROM:-}
      - EMAIL_TO=${EMAIL_TO:-}
      - IMAP_HOST=${IMAP_HOST:-}
      - IMAP_PORT=${IMAP_PORT:-993}
      - IMAP_USER=${IMAP_USER:-}
      - IMAP_PASS=${IMAP_PASS:-}
      - IMAP_SECURE=${IMAP_SECURE:-true}
      - IMAP_POLL_INTERVAL=${IMAP_POLL_INTERVAL:-60}
      - IMAP_AUTO_CREATE_CONTACT=${IMAP_AUTO_CREATE_CONTACT:-true}
      - IMAP_TENANT_ID=${IMAP_TENANT_ID:-}
      - IMAP_CLIENT_ID=${IMAP_CLIENT_ID:-}
      - IMAP_CLIENT_SECRET=${IMAP_CLIENT_SECRET:-}
      - OFFSITE_BACKUP_CMD=${OFFSITE_BACKUP_CMD:-}
      - PUSH_AGING_DAYS=${PUSH_AGING_DAYS:-7}
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    networks:
      - ticketing

  frontend:
    image: it-ticketing-frontend:latest
    container_name: it-ticketing-frontend
    restart: unless-stopped
    ports:
      - "${FRONTEND_PORT:-8082}:80"
    depends_on:
      - backend
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
    networks:
      - ticketing

networks:
  ticketing:
    driver: bridge

volumes:
  it-ticketing-data:
    driver: local
COMPOSE_EOF
ok "docker-compose.local.yml skapad"

# --- 6. Bygg Docker-images ---
header "Bygger Docker-images"

info "Backend... (kan ta 1-2 minuter)"
docker build -f Dockerfile.server -t it-ticketing-backend:latest . --quiet > /dev/null
ok "Backend-image klar"

info "Frontend... (kan ta 1-2 minuter)"
docker build -f Dockerfile.client -t it-ticketing-frontend:latest . --quiet > /dev/null
ok "Frontend-image klar"

# --- 7. Docker-volym ---
header "Docker-volym"
docker volume create it-ticketing-data > /dev/null 2>&1 || true
ok "Volym 'it-ticketing-data' redo"

# --- 8. Starta stack ---
header "Startar system"
docker compose -f docker-compose.local.yml --env-file .env down --remove-orphans > /dev/null 2>&1 || true
docker compose -f docker-compose.local.yml --env-file .env up -d
ok "Containers startade"

# --- 9. Vänta på backend ---
header "Väntar på backend"
info "Pollar http://localhost:${BACKEND_PORT}/api/health..."

MAX_WAIT=60
WAITED=0
printf "  "
until curl -sf "http://localhost:${BACKEND_PORT}/api/health" > /dev/null 2>&1; do
  if [ "$WAITED" -ge "$MAX_WAIT" ]; then
    echo ""
    echo ""
    err "Backend svarade inte efter ${MAX_WAIT}s. Kontrollera loggar: docker logs it-ticketing-backend"
  fi
  sleep 2
  WAITED=$((WAITED + 2))
  printf "."
done
echo ""
ok "Backend svarar (${WAITED}s)"

# --- 10. Initiera databas med admin-användare ---
header "Initierar databas"
docker exec -e ADMIN_EMAIL="${ADMIN_EMAIL}" -e ADMIN_PASSWORD="${ADMIN_PASSWORD}" -e ADMIN_NAME="${ADMIN_NAME}" \
  it-ticketing-backend node dist/db/init.js
ok "Databas initierad med admin: ${ADMIN_EMAIL}"

# --- 11. Klar! ---
header "Installation klar — ${COMPANY_NAME}"
echo -e "  ${BOLD}Öppna systemet i din webbläsare:${NC}"
echo ""
echo -e "    URL:      ${GREEN}${APP_URL}${NC}"
echo -e "    E-post:   ${GREEN}${ADMIN_EMAIL}${NC}"
echo -e "    Lösenord: ${GREEN}(det du angav vid installation)${NC}"
if [ -n "$ANTHROPIC_API_KEY" ]; then
  echo -e "    AI:       ${GREEN}Aktiverad${NC}"
else
  echo -e "    AI:       ${YELLOW}Inaktiverad (lägg till ANTHROPIC_API_KEY i .env)${NC}"
fi
echo ""
echo -e "  ${BOLD}Hantera systemet:${NC}"
echo "    cd ${INSTALL_DIR}"
echo "    docker compose -f docker-compose.local.yml --env-file .env up -d    # Starta"
echo "    docker compose -f docker-compose.local.yml --env-file .env down     # Stoppa"
echo "    docker compose -f docker-compose.local.yml logs -f                  # Loggar"
echo ""
echo -e "  ${BOLD}Konfiguration:${NC} ${INSTALL_DIR}/.env"
echo ""

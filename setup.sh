#!/bin/bash
# IT Ticket System - Setup-script
# Klonar repot och sätter upp ett färdigt system från grunden.
#
# Kör med:
#   bash <(curl -fsSL https://raw.githubusercontent.com/OWNER/REPO/main/setup.sh)
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
  git -C "$INSTALL_DIR" remote add origin "$REPO_URL" 2>/dev/null || \
    git -C "$INSTALL_DIR" remote set-url origin "$REPO_URL"
  git -C "$INSTALL_DIR" pull origin main --quiet
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
header "Konfiguration"
echo -e "  Tryck ${BOLD}Enter${NC} för att använda standardvärden (visas i [hakparentes])\n"

read -rp "  Frontend-port [8082]: " FRONTEND_PORT </dev/tty
FRONTEND_PORT=${FRONTEND_PORT:-8082}

read -rp "  Backend-port [3002]: " BACKEND_PORT </dev/tty
BACKEND_PORT=${BACKEND_PORT:-3002}

# Auto-detektera serverns primära IP-adress
LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if ($i=="src") print $(i+1)}' | head -1)
if [ -z "$LOCAL_IP" ]; then
  LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}')
fi
if [ -z "$LOCAL_IP" ]; then
  LOCAL_IP="localhost"
fi

DEFAULT_URL="http://${LOCAL_IP}:${FRONTEND_PORT}"
read -rp "  App-URL (för CORS och e-postlänkar) [${DEFAULT_URL}]: " APP_URL </dev/tty
APP_URL=${APP_URL:-$DEFAULT_URL}

# Validera att URL börjar med http:// eller https://
if [[ "$APP_URL" != http://* && "$APP_URL" != https://* ]]; then
  warn "URL saknar protokoll — lägger till http:// automatiskt"
  APP_URL="http://${APP_URL}"
fi

echo ""
echo -e "  ${BOLD}SMTP-konfiguration${NC} (valfritt — tryck Enter för att hoppa över)"
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

# --- 4. Generera JWT_SECRET ---
JWT_SECRET=$(openssl rand -base64 32)
ok "JWT_SECRET genererad"

# --- 5. Skriv .env ---
cat > .env << EOF
# Genererat av setup.sh $(date +%Y-%m-%d\ %H:%M)

FRONTEND_PORT=${FRONTEND_PORT}
BACKEND_PORT=${BACKEND_PORT}
CORS_ORIGIN=${APP_URL}
APP_BASE_URL=${APP_URL}
JWT_SECRET=${JWT_SECRET}
SMTP_HOST=${SMTP_HOST}
SMTP_PORT=${SMTP_PORT}
SMTP_USER=${SMTP_USER}
SMTP_PASS=${SMTP_PASS}
EMAIL_FROM=${EMAIL_FROM}
EMAIL_TO=${EMAIL_TO}

# Krävs av Vite vid bygge (används ej i produktionen)
VITE_SUPABASE_URL=http://localhost
VITE_SUPABASE_PUBLISHABLE_KEY=placeholder
EOF
ok ".env skapad"

# --- 5b. Generera docker-compose.local.yml ---
cat > docker-compose.local.yml << 'COMPOSE_EOF'
version: '3.8'

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
      - JWT_SECRET=${JWT_SECRET}
      - DB_PATH=/app/data/database.sqlite
      - UPLOAD_DIR=/app/data/uploads
      - CORS_ORIGIN=${CORS_ORIGIN}
      - APP_BASE_URL=${APP_BASE_URL}
      - SMTP_HOST=${SMTP_HOST:-}
      - SMTP_PORT=${SMTP_PORT:-587}
      - SMTP_USER=${SMTP_USER:-}
      - SMTP_PASS=${SMTP_PASS:-}
      - EMAIL_FROM=${EMAIL_FROM:-}
      - EMAIL_TO=${EMAIL_TO:-}
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
docker compose -f docker-compose.local.yml down --remove-orphans > /dev/null 2>&1 || true
docker compose -f docker-compose.local.yml up -d
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

# --- 10. Initiera databas ---
header "Initierar databas"
INIT_OUTPUT=$(docker exec it-ticketing-backend npm run init-db 2>&1)
echo "$INIT_OUTPUT"
ADMIN_PASSWORD=$(echo "$INIT_OUTPUT" | grep '^ADMIN_PASSWORD=' | cut -d= -f2)
ok "Databas initierad"

# --- 11. Klar! ---
header "Installation klar!"
echo -e "  ${BOLD}Öppna systemet i din webbläsare:${NC}"
echo ""
echo -e "    URL:      ${GREEN}${APP_URL}${NC}"
echo -e "    E-post:   ${GREEN}admin@example.com${NC}"
if [ -n "$ADMIN_PASSWORD" ]; then
  echo -e "    Lösenord: ${GREEN}${ADMIN_PASSWORD}${NC}"
  echo ""
  warn "Spara detta lösenord — det visas bara en gång!"
else
  echo -e "    Lösenord: ${YELLOW}(se utskriften från databas-initialiseringen ovan)${NC}"
fi
echo ""
echo -e "  ${BOLD}Hantera systemet:${NC}"
echo "    docker compose -f ${INSTALL_DIR}/docker-compose.local.yml up -d    # Starta"
echo "    docker compose -f ${INSTALL_DIR}/docker-compose.local.yml down     # Stoppa"
echo "    docker compose -f ${INSTALL_DIR}/docker-compose.local.yml logs -f  # Loggar"
echo ""

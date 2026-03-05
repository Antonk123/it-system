#!/bin/bash
# IT Ticket System - Avinstallationsscript
# Tar bort containers, images, volymer och installationskatalogen.
#
# Kör med:
#   bash uninstall.sh

# --- Konfiguration ---
INSTALL_DIR="/opt/it-ticketing"
LEGACY_DIR="$HOME/it-ticketing"

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

echo -e "\n${BOLD}IT Ticket System — Avinstallation${NC}"
echo "  ─────────────────────────────────"
echo ""
warn "Detta tar bort ALLT: containers, images, volymer och installationskatalogen."
warn "All data (tickets, bilagor, användare) raderas permanent."
echo ""
read -r -p "  Är du säker? (skriv 'ja' för att fortsätta): " CONFIRM </dev/tty
if [ "$CONFIRM" != "ja" ]; then
  echo ""
  info "Avinstallation avbröts."
  exit 0
fi

# --- Hitta installationskatalog ---
if [ -d "$INSTALL_DIR" ]; then
  DIR="$INSTALL_DIR"
elif [ -d "$LEGACY_DIR" ]; then
  DIR="$LEGACY_DIR"
  warn "Hittade installation i $LEGACY_DIR (äldre installation)"
else
  DIR=""
fi

# --- Stoppa och ta bort containers ---
header "Stoppar containers"
if [ -n "$DIR" ] && [ -f "$DIR/docker-compose.local.yml" ]; then
  ENV_FLAG=""
  [ -f "$DIR/.env" ] && ENV_FLAG="--env-file $DIR/.env"
  docker compose -f "$DIR/docker-compose.local.yml" $ENV_FLAG down --volumes --remove-orphans 2>/dev/null && ok "Containers stoppade och borttagna" || info "Inga aktiva containers hittades"
else
  docker rm -f it-ticketing-backend it-ticketing-frontend 2>/dev/null && ok "Containers borttagna" || info "Inga containers hittades"
fi

# --- Ta bort Docker-images ---
header "Tar bort Docker-images"
docker rmi it-ticketing-backend:latest 2>/dev/null && ok "Image it-ticketing-backend borttagen" || info "Image it-ticketing-backend hittades inte"
docker rmi it-ticketing-frontend:latest 2>/dev/null && ok "Image it-ticketing-frontend borttagen" || info "Image it-ticketing-frontend hittades inte"

# --- Ta bort volym ---
header "Tar bort datavolym"
docker volume rm it-ticketing-data 2>/dev/null && ok "Volym it-ticketing-data borttagen" || info "Volym hittades inte"

# --- Ta bort nätverket ---
docker network rm it-ticketing_ticketing 2>/dev/null || true

# --- Ta bort installationskatalog ---
header "Tar bort installationskatalog"
if [ -n "$DIR" ]; then
  rm -rf "$DIR"
  ok "Katalog $DIR borttagen"
else
  info "Ingen installationskatalog hittades"
fi

# --- Klar ---
header "Avinstallation klar"
ok "IT Ticket System är helt borttaget."
echo ""
info "Kör setup.sh igen för en ny installation."
echo ""

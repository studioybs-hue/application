#!/usr/bin/env bash
# ============================================================================
# CINÉMARIÉS — Déploiement web atomique (Nginx-safe)
# ============================================================================
# Ce script :
#   1) Compile le bundle web Expo dans /app/frontend/dist
#   2) Copie le résultat vers un dossier de staging horodaté sur /var/www
#   3) Bascule un symlink atomique -> /var/www/cinemaries/current
#   4) Conserve les 3 dernières releases pour rollback rapide
#   5) Recharge Nginx (sans le redémarrer -> aucune coupure)
#
# ⚠️  Nginx doit pointer sur : /var/www/cinemaries/current
#     (symlink -> /var/www/cinemaries/releases/YYYYMMDD-HHMMSS)
#
# Usage sur VPS (en tant que root ou via sudo) :
#   cd /srv/cinemaries && bash scripts/deploy_web.sh
#
# Rollback rapide :
#   ls /var/www/cinemaries/releases/          # lister
#   ln -sfn /var/www/cinemaries/releases/<REL> /var/www/cinemaries/current
#   nginx -s reload
# ============================================================================

set -euo pipefail

# --- CONFIG ---------------------------------------------------------------
APP_DIR="${APP_DIR:-/srv/cinemaries}"
FRONTEND_DIR="$APP_DIR/frontend"
WWW_ROOT="${WWW_ROOT:-/var/www/cinemaries}"
RELEASES_DIR="$WWW_ROOT/releases"
CURRENT_LINK="$WWW_ROOT/current"
KEEP_RELEASES="${KEEP_RELEASES:-3}"
BACKEND_URL="${EXPO_PUBLIC_BACKEND_URL:-}"       # laisser vide => chemins relatifs "/api"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
NEW_RELEASE="$RELEASES_DIR/$TIMESTAMP"

# --- COULEURS -------------------------------------------------------------
GREEN='\033[0;32m'; RED='\033[0;31m'; YELLOW='\033[1;33m'; NC='\033[0m'
log()   { echo -e "${GREEN}[deploy]${NC} $*"; }
warn()  { echo -e "${YELLOW}[deploy]${NC} $*"; }
die()   { echo -e "${RED}[deploy] ERREUR :${NC} $*" >&2; exit 1; }

# --- VÉRIFS PRÉ-REQUIS ----------------------------------------------------
[[ -d "$FRONTEND_DIR" ]] || die "Frontend introuvable : $FRONTEND_DIR"
command -v npx >/dev/null || die "npx introuvable (installe Node.js 20+)"
command -v rsync >/dev/null || die "rsync introuvable (apt install rsync)"
command -v nginx >/dev/null || warn "nginx introuvable dans PATH — le reload sera skippé"

log "Répertoire projet : $APP_DIR"
log "Racine web        : $WWW_ROOT"
log "Nouvelle release  : $NEW_RELEASE"

# --- BUILD ----------------------------------------------------------------
cd "$FRONTEND_DIR"

log "Nettoyage de l'ancien build local (dist/)..."
rm -rf dist

log "Installation des dépendances (yarn install --frozen-lockfile)..."
yarn install --frozen-lockfile

log "Compilation du bundle web (npx expo export --platform web)..."
if [[ -n "$BACKEND_URL" ]]; then
  EXPO_PUBLIC_BACKEND_URL="$BACKEND_URL" npx expo export --platform web --output-dir dist
else
  # Chemin relatif => l'app tape /api directement (via Nginx reverse proxy)
  EXPO_PUBLIC_BACKEND_URL="" npx expo export --platform web --output-dir dist
fi

# Sanity check : le build doit contenir un index.html
[[ -f dist/index.html ]] || die "Build échoué : dist/index.html introuvable"

# --- PUBLICATION ATOMIQUE -------------------------------------------------
log "Création du dossier de release : $NEW_RELEASE"
sudo mkdir -p "$NEW_RELEASE"

log "Copie du build via rsync (--delete)..."
sudo rsync -a --delete dist/ "$NEW_RELEASE/"

log "Ajustement des permissions (www-data)..."
sudo chown -R www-data:www-data "$NEW_RELEASE" || true
sudo find "$NEW_RELEASE" -type d -exec chmod 755 {} \;
sudo find "$NEW_RELEASE" -type f -exec chmod 644 {} \;

log "Bascule atomique du symlink : current -> $TIMESTAMP"
sudo ln -sfn "$NEW_RELEASE" "$CURRENT_LINK.tmp"
sudo mv -Tf "$CURRENT_LINK.tmp" "$CURRENT_LINK"

# --- RELOAD NGINX ---------------------------------------------------------
if command -v nginx >/dev/null; then
  log "Test de la config Nginx..."
  sudo nginx -t
  log "Reload Nginx (sans coupure)..."
  sudo nginx -s reload
else
  warn "Nginx non détecté — reload manuel requis."
fi

# --- ROTATION DES ANCIENNES RELEASES --------------------------------------
log "Rotation : on garde les $KEEP_RELEASES dernières releases."
cd "$RELEASES_DIR"
ls -1t | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
  log "  suppression de $old"
  sudo rm -rf "$RELEASES_DIR/$old"
done

# --- CHECK FINAL ----------------------------------------------------------
log "Vérification finale : curl -sI https://cinemaries.fr/"
if command -v curl >/dev/null; then
  code=$(curl -sI -o /dev/null -w "%{http_code}" https://cinemaries.fr/ || echo "000")
  if [[ "$code" == "200" ]]; then
    log "✅ Déploiement réussi — HTTP 200"
  else
    warn "⚠️  Code HTTP inattendu : $code (vérifiez Nginx)"
  fi
fi

log "🚀 Terminé. Release active : $TIMESTAMP"
log "   Rollback : ln -sfn <ancienne_release> $CURRENT_LINK && sudo nginx -s reload"

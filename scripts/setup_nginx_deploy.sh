#!/usr/bin/env bash
# ============================================================================
# CINÉMARIÉS — Setup initial du dossier web sur le VPS
# ============================================================================
# À exécuter UNE SEULE FOIS lors de la migration vers le déploiement atomique.
# Après ça, seul deploy_web.sh est utilisé pour les mises à jour.
#
# Ce script :
#   1) Crée /var/www/cinemaries/releases/
#   2) Migre l'ancien dossier web-build/ (s'il existe) en release initiale
#   3) Crée le symlink current -> première release
#   4) Affiche le bloc de conf Nginx à copier
#
# Usage :
#   sudo bash /srv/cinemaries/scripts/setup_nginx_deploy.sh
# ============================================================================
set -euo pipefail

WWW_ROOT="/var/www/cinemaries"
OLD_BUILD="$WWW_ROOT/web-build"
RELEASES_DIR="$WWW_ROOT/releases"
CURRENT_LINK="$WWW_ROOT/current"
INIT_RELEASE="$RELEASES_DIR/initial-$(date +%Y%m%d-%H%M%S)"

echo "→ Création de $RELEASES_DIR"
mkdir -p "$RELEASES_DIR"

if [[ -d "$OLD_BUILD" ]] && [[ ! -L "$OLD_BUILD" ]] && [[ -f "$OLD_BUILD/index.html" ]]; then
  echo "→ Migration de l'ancien build $OLD_BUILD -> $INIT_RELEASE"
  mkdir -p "$INIT_RELEASE"
  rsync -a "$OLD_BUILD/" "$INIT_RELEASE/"
  chown -R www-data:www-data "$INIT_RELEASE"
  ln -sfn "$INIT_RELEASE" "$CURRENT_LINK"
  # On renomme l'ancien dossier pour ne rien perdre
  mv "$OLD_BUILD" "$OLD_BUILD.backup-$(date +%s)"
  echo "→ Ancien dossier renommé en $OLD_BUILD.backup-*"
else
  echo "→ Aucun ancien build à migrer (ou déjà migré)."
fi

echo ""
echo "==============================================================="
echo "✅ Setup terminé."
echo ""
echo "⚠️  ADAPTE TA CONF NGINX pour pointer sur le symlink :"
echo ""
echo "  server {"
echo "    listen 443 ssl http2;"
echo "    server_name cinemaries.fr www.cinemaries.fr;"
echo ""
echo "    root $CURRENT_LINK;"
echo "    index index.html;"
echo ""
echo "    # Route SPA (Expo Router)"
echo "    location / {"
echo "      try_files \$uri \$uri.html \$uri/ /index.html;"
echo "    }"
echo ""
echo "    # API FastAPI"
echo "    location /api/ {"
echo "      proxy_pass http://127.0.0.1:8001;"
echo "      proxy_http_version 1.1;"
echo "      proxy_set_header Host \$host;"
echo "      proxy_set_header X-Real-IP \$remote_addr;"
echo "      proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;"
echo "      proxy_set_header X-Forwarded-Proto \$scheme;"
echo "      client_max_body_size 200M;"
echo "      proxy_read_timeout 300;"
echo "    }"
echo ""
echo "    # Uploads (vidéos/livre d'or)"
echo "    location /uploads/ {"
echo "      alias /srv/cinemaries/uploads/;"
echo "      access_log off;"
echo "      add_header Cache-Control \"public, max-age=31536000, immutable\";"
echo "    }"
echo ""
echo "    ssl_certificate     /etc/letsencrypt/live/cinemaries.fr/fullchain.pem;"
echo "    ssl_certificate_key /etc/letsencrypt/live/cinemaries.fr/privkey.pem;"
echo "  }"
echo ""
echo "  # Redirection HTTP -> HTTPS"
echo "  server {"
echo "    listen 80;"
echo "    server_name cinemaries.fr www.cinemaries.fr;"
echo "    return 301 https://\$host\$request_uri;"
echo "  }"
echo ""
echo "→ Puis : sudo nginx -t && sudo nginx -s reload"
echo "==============================================================="

# CINÉMARIÉS — PRD & Session Log

## Product Overview
Netflix-style mobile app for wedding videos. iOS app is LIVE (Reader App compliance). Android is LIVE. Web at cinemaries.fr. Features: private wedding films via access codes, Stripe Premium subscriptions, lifetime hosting, Chromecast, Push Notifications, restricted Photo Gallery, public Discover, Admin dashboard, **9-step project tracking with SMS+email notifications**, **admin-editable SMTP/SMS config**.

## Language
User's primary language: **French** — always respond in French.

## Critical Constraints
- **Apple Reader App compliance (Guideline 3.1.3a)**: NEVER add subscription purchase, access code entry, or account registration UI on iOS native app. Enforced via `IS_IOS_NATIVE` from `frontend/src/utils/platform.ts`.
- **Emergency VPS recovery**: old IONOS VPS deleted, new VPS is `31.70.142.150`.

## Current Status (2026-09-11)

### 🚨 Hotfix 2026-09-11 (soir) — Home page en loader infini
- **Root cause** : Le dossier VPS `/var/www/cinemaries/frontend/app/` avait été corrompu lors d'un rsync précédent. `app/index.tsx` contenait le code de `admin/index.tsx` (dashboard admin) au lieu du splash. Plusieurs fichiers admin (`videos.tsx`, `codes.tsx`, `users.tsx`, `hosting.tsx`, `settings.tsx`, `contact.tsx`, `devis.tsx`, `deletion-requests.tsx`, `wedding-covers.tsx`, `wedding-photos/*.tsx`, `video-edit/*.tsx`, `support/*.tsx`, `guestbook/*.tsx`) étaient DUPLIQUÉS à la racine de `app/`, court-circuitant les routes normales.
- **Symptôme** : `https://cinemaries.fr/` restait bloqué sur "ADMIN CINÉMARIÉS" + spinner doré infini (même en navigation privée et sur mobile). L'app faisait un appel à `/api/admin/stats` renvoyant 401.
- **Fix** :
  1. Backup du VPS `app/` → `app.bak.20260911-233503`
  2. `rsync -avz --delete /app/frontend/app/ VPS:/var/www/cinemaries/frontend/app/` (targeted sur `app/` uniquement)
  3. Rebuild : `npx expo export --platform web --output-dir dist.new` sur le VPS
  4. Atomic swap : `dist` → `dist.old.20260911-233653`, `dist.new` → `dist`
  5. `nginx -s reload`
- **Résultat** : `/` affiche le splash CINÉMARIÉS puis redirige vers `/home` (hero, tabs, guestbook actif). `/admin`, `/discover`, `/auth/login` OK.
- **Sanity check** : ⚠️ `app.bak.previous` sur le VPS pourrait contenir un app.tsx corrompu — utiliser désormais le nouveau `app.bak.20260911-233503` comme référence.

### ✅ Completed this session (rebuild prep)
0. **Rebuild prep 1.6.1** :
   - iOS Reader App audit : bandeau "Livre d'or" masqué sur iOS natif (home + guestbook-list) — évite rejet Apple
   - Version bumped : `1.6.0` → `1.6.1` (Android versionCode 4→5, iOS buildNumber 1→13)
   - Nouveau script `scripts/deploy_web.sh` : déploiement atomique via symlink + rotation (fini les 403 Nginx après build)
   - Nouveau script `scripts/setup_nginx_deploy.sh` : setup initial du dossier `/var/www/cinemaries/` + conf Nginx recommandée
1. **DNS + SSL + site remise en route** — SSL Let's Encrypt actif jusqu'au 10 déc. 2026
2. **Migration dev → VPS** — 5 users, 33 codes, 11 videos, 4 tickets support, 911 Mo de fichiers
3. **Feature "Suivi de projet"** implémentée à l'identique de creativindustry.com :
   - 9 étapes : Vidage cartes, Sauvegarde serveurs, Tri, Retouche/Montage, Photos déposées, Sélection 40 photos, Musique, Vérification qualité, Livraison
   - 3 états visuels (vert Terminé / jaune En cours / gris À venir)
   - Barre de progression jaune→vert en dégradé
   - Note publique par admin + ETA
   - Notifications automatiques : Email (IONOS SMTP) + SMS (Brevo)
4. **Admin Settings SMTP/SMS** — Config email et SMS Brevo modifiable depuis l'admin avec bouton "Tester la config" (envoie un email/SMS de test)
   - `mailer.py` et `project_tracking.py` lisent d'abord la DB (`app_settings` collection), fallback env
   - Cache 30s en mémoire pour éviter DB hit à chaque email

### 🔴 Pending (P0)
- **User doit mettre à jour le password SMTP IONOS + le port** via `/admin/settings` (Email SMTP tab). Actuellement port 587 avec SSL=on = incompatible.
- **Stripe Live keys** — placeholders, tous les paiements bloqués

### 🟡 Backlog (P1)
- Sauvegardes automatiques MongoDB + uploads → Backblaze B2 (nightly cron)
- UptimeRobot monitoring
- Push notifications (nécessite rebuild iOS/Android via Publish)

### 🟢 Future features (P2)
- Livre d'or numérique (web only — avoid Apple re-review)
- Admin UX: direct Photos/Videos links from wedding list
- Admin: edit contact info

## New Files Created
### Backend
- `/app/backend/project_tracking.py` — Complete module (routes, models, notif service, Brevo SMS)
- `/app/backend/app_settings.py` — DB-first settings storage (SMTP + Brevo), replaces env fallback
- `/app/backend/mailer.py` — Updated to read config from DB first

### Frontend
- `/app/frontend/src/features/project-tracking/ProjectTrackingView.tsx` — Reusable stepper component
- `/app/frontend/app/admin/projects/index.tsx` — Admin list of projects + candidates
- `/app/frontend/app/admin/projects/[clientId].tsx` — Admin project detail (edit steps, notes, ETA)
- `/app/frontend/app/admin/settings.tsx` — SMTP + Brevo config UI
- `/app/frontend/app/(tabs)/profile.tsx` — Added `ProjectTrackingView` card for clients
- `/app/frontend/app/admin/index.tsx` — Added 2 new admin entries

## New API Endpoints
- `GET  /api/projects/me` — Client's own tracking (admin sees first as preview)
- `GET  /api/admin/projects` — List all projects (auto-syncs from wedding_claims)
- `GET  /api/admin/projects-candidates` — Distinct client_ids that could be tracked
- `POST /api/admin/projects` — Create tracking for a wedding
- `GET  /api/admin/projects/{client_id}` — Detail
- `PATCH /api/admin/projects/{client_id}` — Update name/email/phone/note/ETA
- `PATCH /api/admin/projects/{client_id}/steps/{step_key}` — Update step status (triggers notif)
- `POST /api/admin/projects/{client_id}/test-notify` — Test email/SMS
- `DELETE /api/admin/projects/{client_id}` — Remove tracking
- `GET  /api/admin/settings/smtp` — Current SMTP config (password masked)
- `PUT  /api/admin/settings/smtp` — Update SMTP config
- `POST /api/admin/settings/smtp/test` — Send test email
- `GET  /api/admin/settings/brevo-sms` — Current Brevo SMS config
- `PUT  /api/admin/settings/brevo-sms` — Update Brevo config
- `POST /api/admin/settings/brevo-sms/test` — Send test SMS

## New DB Collections
- `project_tracking` — one doc per wedding, with 9 steps array
- `app_settings` — key/value pairs for `smtp` and `brevo_sms`

## Tech Stack
- Backend: FastAPI + MongoDB (`cinemaries` DB) + FFmpeg
- Frontend: Expo Router + React Native (SDK 54)
- Hosting: VPS at `31.70.142.150`, Nginx reverse-proxy, systemd `cinemaries-backend.service`
- SSL: Let's Encrypt via Certbot
- Payments: Stripe (Live mode — pending keys)
- Email: IONOS SMTP (via `mailer.py`, config in DB `app_settings.smtp`)
- SMS: Brevo Transactional (Sender ID `CINEMARIES`, 302 credits available on account `contact@creativindustry.com`)

## Credentials
- Admin: `admin@wedding.fr` / `Admin13!`
- VPS: `root@31.70.142.150` / `Xp9dnmy91rRO`
- Brevo API key: stored in `.env` + DB (`app_settings.brevo_sms`) — user shared it in chat, should rotate after go-live

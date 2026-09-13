# CINÉMARIÉS — PRD & Session Log

## Product Overview
Netflix-style mobile app for wedding videos. iOS app is LIVE (Reader App compliance). Android is LIVE. Web at cinemaries.fr. Features: private wedding films via access codes, Stripe Premium subscriptions, lifetime hosting, Chromecast, Push Notifications, restricted Photo Gallery, public Discover, Admin dashboard, **9-step project tracking with SMS+email notifications**, **admin-editable SMTP/SMS config**.

## Language
User's primary language: **French** — always respond in French.

## Critical Constraints
- **Apple Reader App compliance (Guideline 3.1.3a)**: NEVER add subscription purchase, access code entry, or account registration UI on iOS native app. Enforced via `IS_IOS_NATIVE` from `frontend/src/utils/platform.ts`.
- **Emergency VPS recovery**: old IONOS VPS deleted, new VPS is `31.70.142.150`.

## Current Status (2026-09-13)

### ✅ Feature 2026-09-13 — Livrables du suivi de projet (photos / sélection 40 / musique / livraison)
- **Backend** : nouveau module `backend/project_deliverables.py` (enregistré en fin de `server.py`, après l'auto-import).
  - Données dans `project_tracking.deliverables` : `photos {mode gallery|link, link, imported_count, import{status,total,done,error}}`, `selection {photo_ids, filenames, filenames_text, link, note, count, submitted_at}`, `music {title, artist, link, note, file_url}`, `delivery {link}`.
  - Client : `GET /projects/{cid}/deliverables`, `POST /projects/{cid}/selection` (max 40), `POST /projects/{cid}/music`, `POST /projects/{cid}/music/file` (multipart ≤ 40 Mo). Accès : admin, `users.client_id`/`claimed_client_id` ou `project.owner_user_id`.
  - Admin : `PATCH /admin/projects/{cid}/deliverables {photos_link, delivery_link, notify}`, `GET …/zip-candidates`, `POST …/photos/import-zip {filename}` (ZIP dans ftp_drop, tâche de fond, ZIP supprimé après succès), `POST …/photos/import-zip/upload` (multipart), `GET …/selection/download?token=JWT` (ZIP des photos cochées).
  - Étapes auto → « Terminé » : photos_delivery (ZIP importé ou lien posé, mariés notifiés), photo_selection, music (alerte admin), delivery (lien posé, mariés notifiés). Alertes admin = réglages email/SMS de l'import automatique (`app_settings.auto_import`).
  - **Watcher FTP** : `auto_import.AutoImporter.zip_handler` → tout `.zip` déposé dans ftp_drop (ex. « Yassina & Bensaid photos.zip », mots-clés photos/photo/galerie ignorés) est extrait dans la galerie du suivi correspondant (match suivis puis mariages ; sinon job PENDING). Journalisé dans `import_jobs` (type `photos_zip`).
  - `photos.py` : `_wedding_exists` accepte suivi de projet / wedding_meta (photos avant le film) ; accès galerie aussi via `claimed_client_id` et `owner_user_id` ; `PHOTOS_PER_WEDDING_MAX=3000`, `ZIP_MAX_PHOTOS=200`.
- **Frontend** : `ProjectTrackingView` prop `stepActions` (bouton or + hint sous une étape) ; `coupleStepActions.ts` (profil mariés) ; galerie `/photos/[clientId]?select=1` = mode « Choisir mes 40 photos » (compteur, cœurs, Valider) ; écrans `/projects/[clientId]/selection` (liste de noms + lien, mode Synology) et `/projects/[clientId]/music` ; admin `AdminDeliverablesPanel` dans `/admin/projects/[clientId]` (lien Synology, import ZIP FTP/upload, sélection reçue + ZIP, musique reçue, lien livraison).
- Tests : `backend/tests/deliverables_e2e.py` (TOUT OK) ; testing agent `iteration_17` 8/8 frontend PASSED.
- **✅ Déployé en production le 2026-09-13 17:16** : backend (backup `/root/backups/<ts>/`, sync ciblé 4 fichiers, `systemctl restart cinemaries-backend`), frontend (tar ciblé des fichiers modifiés → `npx expo export` dans `dist.new` → swap atomique, ancien dist `dist.old.20260913-171602`). API `/api/projects/*/deliverables` → 401 sans token (OK), route `/projects/yassina/music` rendue. Reste : builds natifs v1.6.5 via Publish (action utilisateur).
- **Archives RAR / 7z** (2026-09-13 17:29) : le client dépose des `.rar` (WinRAR, RAR v5). `extract_archive()` gère `.zip` (zipfile), `.rar` (`unrar`, installé sur le VPS via apt `unrar`), `.7z` (`7z`, apt `p7zip-full`) ; `_which()` cherche dans /usr/bin car le PATH du service systemd est réduit. Hook watcher étendu à `.zip/.rar/.7z`. Test prod : « Yassina  photo.rar » (187 Mo, 40 JPG) → 40 photos dans la galerie `yassina`, étape 5 « Terminé ». Pour relancer un job en ERROR sur un fichier inchangé : supprimer le doc `import_jobs` correspondant (ou renommer le fichier).
- **v2 livrables (2026-09-13 18:00, déployée)** : liens multiples libellés `photos.links[]` / `delivery.links[]` (`PATCH …/deliverables {photos_links:[{label,url}], delivery_links:[…]}`, `link` = 1er lien pour compat) → un bouton par lien chez les mariés (`StepAction[]`). Cas Synology : plus de liste de noms — les mariés **envoient leurs photos choisies** (`POST /projects/{cid}/selection/upload` multipart, max `SELECTION_UPLOAD_MAX=50`, 60 Mo/photo, stockées `uploads/photos/{cid}/selection/` + thumbs ; `DELETE …/selection/upload/{id}`), puis `POST /projects/{cid}/selection` valide (count = uploads). Admin : vignettes + ZIP (`selection/download` inclut uploads). Écran `/projects/[clientId]/selection` = grille d'upload (expo-image-picker, permissions gérées). Tests : iteration_18 6/6.
- ⚠️ Le mot de passe admin prod `contact@cinemaries.fr` a été changé par l'utilisateur (l'ancien `Reset2026!` ne fonctionne plus) — ne pas tenter de se connecter à l'admin prod sans le demander.

### 🚨 Fix 2026-09-13 — App native (iOS/Android) figée sur une vieille base
- **Symptôme** : nouveaux mariages visibles sur cinemaries.fr mais jamais dans l'app installée (qui affichait encore « Sarahaline »).
- **Root cause** : l'app native était compilée avec `EXPO_PUBLIC_BACKEND_URL` = URL de prévisualisation Emergent (`mariagevideo.preview…`), pas cinemaries.fr → base de données différente/figée.
- **Fix** : nouveau `frontend/src/api/baseUrl.ts` exportant `BACKEND_URL` : sur iOS/Android en build de production → **toujours `https://cinemaries.fr`** ; sur web ou en `__DEV__` → variable d'env. Tous les `process.env.EXPO_PUBLIC_BACKEND_URL` du frontend (16 fichiers) passent par cet export.
- Version bump `1.6.3` → `1.6.5` (iOS buildNumber 15, Android versionCode 7).
- **Action utilisateur** : relancer un build via **Publish** puis soumettre App Store / Play Store. Le web n'est pas impacté (pas de redéploiement VPS nécessaire, mais synchroniser `frontend/src/api/baseUrl.ts` + fichiers modifiés au prochain déploiement).

## Previous Status (2026-09-11)

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

## 2026-09-13 — Importation automatique FTP + corrections Suivi de projet / Livre d'or

### Importation automatique (`backend/auto_import.py`, `frontend/app/admin/auto-import.tsx`)
- Watcher asyncio sur `uploads/ftp_drop` (= `/srv/cinemaries/uploads/ftp_drop` sur le VPS) : scan 5 s, fichier traité 10 s après stabilité (taille/mtime), file d'attente séquentielle, reprise après redémarrage (jobs PROCESSING → PENDING).
- `MarriageFilenameParser` : nomenclature « {Mariés} {mot-clé} [{prestation}] » (`Yassina & Bensaid video complet Oukoumbi.mp4`, `… video complet.mp4`, `… Poster.jpg`, `… Grand format.jpg`, `… bande annonce.mp4`, forme courte `yassina Maoulid.mp4`) + ancienne forme (`Mariage de … soiree.mp4`, `Poster : …`, `Video complete : …`, `Hero grand format : …`, `Bande-annonce : …`). Casse/accents insensibles, fautes de frappe tolérées (SequenceMatcher ≥ 0.85), « & » = « et », correspondance partielle par prénom (inclusion de tokens), prestations inconnues ajoutées automatiquement (catégorie Cérémonies).
- Réutilise `videos` (vidéo principale « À l'affiche » : poster_url/hero_url/trailer_url/full_url ; prestations = vidéos séparées même client_id, champ `import_service`), `wedding_meta` (couverture), stockage `uploads/{uuid}.ext`. Dédoublonnage SHA-256 (→ `ftp_drop/duplicates`), erreurs → `ftp_drop/errors`. Journal `import_jobs` (PENDING/PROCESSING/PROCESSED/ERROR). Réglages `app_settings.auto_import` (services, default_featured=true, default_showcase=true, enabled).
- API admin : `/admin/auto-import/{stats,jobs,settings,scan,parse-test}`, `/admin/auto-import/jobs/{id}/retry`, DELETE `/admin/auto-import/jobs/{id}`.
- Tests : `backend/tests/auto_import_e2e.py` (12 scénarios), `auto_import_suffix_e2e.py`, `test_auto_import_admin_light.py` — tous OK. Frontend validé (iteration_15).

### Suivi de projet / Livre d'or
- Inscription : `account_type` « user » | « couple » (sélecteur sur /auth/register). Compte « couple » relié automatiquement au suivi dont `owner_email` = email (à l'inscription, via /projects/me, ou quand l'admin saisit l'email). Route manuelle POST `/admin/projects/{client_id}/link-user`.
- Suppression d'un suivi : garde `project_tracking_deleted` (plus de recréation auto par la liste) ; dialogues web (`confirmAction`/`showAlert`) à la place de `Alert.alert`.
- Profil : suivi rechargé toutes les 10 s + au focus (temps réel) ; carte d'attente pour les mariés sans suivi.
- Livre d'or « révélation » : plus de code — connexion au compte Mariés (`/auth/login?redirect=`), `/guestbook/mine?client_id=` (claimed_client_id + admin).
- Validé frontend iteration_16.

### Déploiement VPS 2026-09-13 ✅
- Backend (server.py, auto_import.py, project_tracking.py, guestbook.py) rsync → `/var/www/cinemaries/backend`, `systemctl restart cinemaries-backend` (2 workers uvicorn : le watcher tourne dans UN seul worker via flock `.watcher.lock`). Frontend : `app/` + `src/` rsync → `npx expo export --platform web --output-dir dist.new` → swap `dist` (ancien dans `dist.bak.previous`). Sauvegardes dans `/root/backups/`.
- Nouveau mot de passe root VPS : `x4Ys$7yU#HVwA6I@jr!WInL%uMQ#SdrSRs1KE0W4wi`. Mot de passe admin prod `contact@cinemaries.fr` changé par l'utilisateur (Reset2026! ne fonctionne plus).
- ⚠️ Le watcher est **désactivé** en prod (`app_settings.auto_import.enabled=false`) : le dossier ftp_drop contient déjà ~90 Go de fichiers manuels (« soiree Yassina.mp4 », « HALAL Yassina.mp4 », « Mazaraka Hanifa.mp4 », « oukoumbi Sarhaline.mp4 », « Oukopumbi att.mp4 », « soiree.mp4 », « Extrat 1.png »). L'utilisateur doit l'activer depuis Admin → Importation automatique quand il est prêt. Les fichiers au nom invalide restent désormais EN PLACE (jamais déplacés) avec statut ERROR ; seuls les doublons vont dans `duplicates/`.
- Parser : ordre `{prestation} {nom}` aussi accepté (« soiree Yassina.mp4 »). Prestations par défaut ajoutées : halal, mazaraka, madjilis.
- Incident lors du déploiement : l'ancienne version a déplacé 8 fichiers dans errors/ avant la désactivation → tous remis dans ftp_drop, journal purgé.

### Alertes import (2026-09-13) ✅ déployé
- `auto_import._notify` : à chaque job PROCESSED (hors doublon) ou ERROR → email (mailer IONOS, si SMTP configuré) et/ou SMS Brevo. Réglages `app_settings.auto_import` : notify_email (défaut true), notify_email_to (défaut ADMIN_NOTIFY_EMAIL), notify_sms (false), notify_phone, notify_on ("all"|"errors"). Route POST `/admin/auto-import/test-notify`. UI dans Admin → Importation automatique → Prestations & publication → « Alertes à chaque import ».
- Rappel : l'email ne partira réellement que lorsque IONOS autorisera le SMTP externe (blocage connu) ; le SMS Brevo fonctionne indépendamment.

### 2026-09-13 15:05 — Surveillance ACTIVÉE en prod, 1er import réel réussi
- Mariage « Yassina & Bensaid » (client_id `yassina`) créé automatiquement : poster, hero, bande-annonce + prestations Halal, Mairie, Soirée. « Mazaraka Hanifa » → Hanifa et Dali ; « oukoumbi Sarhaline » → Sarahaline & Elarif (fuzzy tokens). Restent en ERROR (en place) : `Oukopumbi att.mp4`, `soiree.mp4`, `Extrat 1.png`.
- Ajouts : `_tokens_included` (prénoms approchés), `_reconcile_name` (nom le plus complet + orthographe majoritaire → renomme le mariage), le job garde le `couple` brut du fichier.

### Stripe LIVE configuré (2026-09-13) ✅
- VPS `.env` : `STRIPE_API_KEY=sk_live_…` (fourni par l'utilisateur), `STRIPE_WEBHOOK_SECRET` (endpoint `we_1UFFA12RzyH118YnXq09MCTh` → https://cinemaries.fr/api/billing/webhook, créé via API), `STRIPE_PRICE_ID_ANNUAL_COMMIT=price_1Tc7I62RzyH118Yn4SAyg5jk`, `STRIPE_PRICE_ID_ANNUAL_FREE=price_1Tc7I72RzyH118Yn74TwpPf9`, `STRIPE_PRICE_ID_MONTHLY_FREE=price_1Tc7I82RzyH118YnHdfLJPKa`. Anciennes variables erronées (STRIPE_SECRET_KEY, STRIPE_PRICE_MONTHLY) supprimées. Sauvegarde .env dans /root/backups/.
- `STRIPE_PUBLISHABLE_KEY` non renseignée (non utilisée : Checkout hébergé). Session Checkout live testée OK.
- Fix `scripts/create_stripe_products.py` (`p.recurring["interval"]`).

### Test paiement réel Stripe LIVE (2026-09-13) ✅
- Compte test `youssouf.ali09@gmail.com` (claim `yassina` inséré manuellement). Paiement 2,30 € OK → Premium activé → webhook corrigé (`obj.to_dict()` : stripe-python 15.x interdit `.get()` sur les ressources) → événements rejoués → remboursement `re_3UFFSL2RzyH118Yn1JhExRNn` (230 cts) → abonnement annulé → webhook `customer.subscription.deleted` a repassé `is_subscribed=false`.
- Fix : `APP_PUBLIC_URL` manquait sur le VPS (success_url invalide → 502) ; ajouté dans `.env` + fallback PUBLIC_BASE_URL dans server.py.

### 2026-09-13 — Confidentialité Premium + robustesse import (déployé)
- **Accès** : Premium ne débloque QUE le mariage du client (`_owns_wedding` : client_id ou claimed_client_id) dans `/weddings/{cid}` et `/videos/{id}` ; codes invités et admin inchangés ; `/client/codes` accepte le mariage revendiqué (`_my_cid`). Auto-assignation d'un mariage par code désactivée si l'utilisateur a déjà revendiqué. Catalogue (affiches/bandes-annonces) reste visible par tous (choix utilisateur).
- **Import** : `default_showcase=false` (prod aussi) ; forme « {mot-clé} {Mariés} » (« Bande anonce hanifa.mp4 », « Poster Yassina.jpg ») ; faute « anonce » tolérée ; prestation inconnue déduite si le début du nom correspond à un mariage existant (`_guess_new_prestation` : « Sarahline Kandou.mp4 » → Kandou) ; `_main_video` recrée la fiche principale « À l'affiche » si l'admin l'a supprimée.
- Prod : fiche principale « Yassina & Bensaid » recréée (l'utilisateur l'avait supprimée) avec poster/hero/bande-annonce ; Kandou + Djaliko ajoutés à Sarhaline & Elarif ; bande-annonce Hanifa relancée.
- ⚠️ L'utilisateur a supprimé/recréé des mariages dans l'admin (sarahaline-elarif → sarhaline). Ne pas supprimer la vidéo « À l'affiche » : c'est elle qui porte poster/hero/bande-annonce/film complet.

### 2026-09-13 — Couverture de mariage + email de bienvenue Premium (déployé)
- `_is_cover_record` (À l'affiche sans full_url) : masquée de `wedding.videos` côté client, `wedding.trailer_url` ajouté (page mariage l'utilise), flag `is_cover` dans `/admin/videos` (liste admin : ligne « Couverture du mariage », cadenas au lieu de la corbeille), DELETE refusé (400) tant que le mariage a d'autres vidéos (`?force=true` pour passer outre).
- Couvertures yassina/sarhaline restaurées en prod à partir de `import_jobs` (l'utilisateur les avait supprimées en croyant à une « fiche démo »).
- `_send_welcome_premium_email` (server.py) : appelé après activation (webhook checkout, billing/refresh heal, StripeSync heal) ; idempotent par `stripe_subscription_id` (`welcome_premium_sent_for`). ⚠️ Non délivré tant que le SMTP IONOS refuse l'auth (535) — proposer SMTP Brevo (Admin → Réglages email).
- 16:12 — Page mariage verrouillée : l'aperçu n'affichait que 3 vidéos (`slice(0,3)`) → toutes affichées ; `video_count` exclut la couverture. Déployé (Hichima visible).
- 16:25 — Candidats suivi de projet : les nouveaux comptes « Mariés » (account_type=couple sans mariage) apparaissent dans « Mariages sans suivi actif » (source « nouveau compte Mariés », email pré-rempli → liaison auto à la création). Déployé. Compte prod concerné : studioyb.s@gmail.com (MAriane).
- 16:40 — Téléphone à l'inscription (`users.phone`, normalisé FR, obligatoire côté UI pour les comptes Mariés) ; liaison auto au suivi par email OU téléphone (`_link_owner_user(cid, email, phone)`, register, /projects/me, création/màj projet). Déployé.

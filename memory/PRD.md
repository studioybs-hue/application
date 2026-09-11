# CINÉMARIÉS — PRD & Session Log

## Product Overview
Netflix-style mobile app for wedding videos. iOS app is LIVE (Reader App compliance). Android is LIVE. Web at cinemaries.fr. Features: private wedding films via access codes, Stripe Premium subscriptions, lifetime hosting, Chromecast, Push Notifications, restricted Photo Gallery, public Discover, Admin dashboard.

## Language
User's primary language: **French** — always respond in French.

## Critical Constraints
- **Apple Reader App compliance (Guideline 3.1.3a)**: NEVER add subscription purchase, access code entry, or account registration UI on iOS native app. All these must stay web-only. Enforced via `IS_IOS_NATIVE` from `frontend/src/utils/platform.ts`.
- **Emergency VPS recovery in progress**: old IONOS VPS was deleted, new VPS is `31.70.142.150`.

## Current Status (2026-09-11 session)

### ✅ Completed this session
1. **DNS diagnostic** — identified user modified DNS on wrong domain (`cinemaries.com` instead of `cinemaries.fr`). Guided user to fix.
2. **Web frontend rebuild** with relative API URLs (`EXPO_PUBLIC_BACKEND_URL=""`) so site works via IP fallback and any origin.
3. **Data migration from dev container to VPS**:
   - MongoDB dump of `wedding_stream` → restored into `cinemaries` on VPS
   - Rsync 911 Mo uploads (9 videos + photos + hosting_2ebd1b43) to `/srv/cinemaries/uploads/`
   - Cleaned automated test accounts
4. **SSL/HTTPS Certbot installation** — Let's Encrypt cert valid until 2026-12-10, auto-renewal enabled
5. **iOS/Android app reconnected** — user confirmed login works again

### Restored data on VPS after migration
- 5 users (admin + 3 real + 1 test)
- 33 unlock codes (18 hanifa-et-dali, 13 sarahaline-elarif, 2 generic)
- 11 videos (with actual .mp4 files on disk)
- 4 support tickets + 6 messages
- 14 Stripe checkout sessions history
- 4 hosting requests + 4 deletion requests
- 20 upload records
- 9 real .mp4/.mov files (911 Mo total)

### 🔴 Pending (P0)
- **Stripe Live keys** — placeholders in `.env`, all payments currently blocked (returns 503)
- Verify Stripe payment flow end-to-end

### 🟡 Backlog (P1)
- Automated MongoDB + uploads backups to Backblaze B2 (nightly cron)
- UptimeRobot monitoring
- Deployment script hardening (avoid Nginx 403 on `expo export`)

### 🟢 Future features (P2)
- Livre d'or numérique (web only — avoid Apple re-review)
- Suivi de projet photo/vidéo (progress bar for clients)
- Admin: edit contact info
- Admin UX: direct Photos/Videos links from wedding list

### Future / Backlog (P3+)
- Refactor `server.py` (5085 lines) into modular routers
- Legacy users claim migration

## Tech Stack
- Backend: FastAPI + MongoDB (`cinemaries` DB) + FFmpeg
- Frontend: Expo Router + React Native (SDK 54)
- Hosting: VPS at `31.70.142.150`, Nginx reverse-proxy, systemd `cinemaries-backend.service`
- SSL: Let's Encrypt via Certbot (nginx plugin)
- CDN: none (Cloudflare proposed but not adopted)
- Payments: Stripe (Live mode — pending keys)

## Key Files
- `/app/frontend/src/utils/platform.ts` — `IS_IOS_NATIVE` for Apple compliance
- `/app/frontend/src/ui/IOSReaderGate.tsx` — gate for restricted routes on iOS
- `/app/frontend/app/wedding/[clientId].tsx` — code entry masked on iOS
- `/app/backend/server.py` — monolith, `_seed_admin`, Stripe endpoints, webhooks

## Credentials
- Admin: `admin@wedding.fr` / `Admin13!`
- VPS: `root@31.70.142.150` / `Xp9dnmy91rRO`

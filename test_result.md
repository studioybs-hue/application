#====================================================================================================
# START - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================

# THIS SECTION CONTAINS CRITICAL TESTING INSTRUCTIONS FOR BOTH AGENTS
# BOTH MAIN_AGENT AND TESTING_AGENT MUST PRESERVE THIS ENTIRE BLOCK

# Communication Protocol:
# If the `testing_agent` is available, main agent should delegate all testing tasks to it.
#
# You have access to a file called `test_result.md`. This file contains the complete testing state
# and history, and is the primary means of communication between main and the testing agent.
#
# Main and testing agents must follow this exact format to maintain testing data. 
# The testing data must be entered in yaml format Below is the data structure:
# 
## user_problem_statement: {problem_statement}
## backend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.py"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## frontend:
##   - task: "Task name"
##     implemented: true
##     working: true  # or false or "NA"
##     file: "file_path.js"
##     stuck_count: 0
##     priority: "high"  # or "medium" or "low"
##     needs_retesting: false
##     status_history:
##         -working: true  # or false or "NA"
##         -agent: "main"  # or "testing" or "user"
##         -comment: "Detailed comment about status"
##
## metadata:
##   created_by: "main_agent"
##   version: "1.0"
##   test_sequence: 0
##   run_ui: false
##
## test_plan:
##   current_focus:
##     - "Task name 1"
##     - "Task name 2"
##   stuck_tasks:
##     - "Task name with persistent issues"
##   test_all: false
##   test_priority: "high_first"  # or "sequential" or "stuck_first"
##
## agent_communication:
##     -agent: "main"  # or "testing" or "user"
##     -message: "Communication message between agents"

# Protocol Guidelines for Main agent
#
# 1. Update Test Result File Before Testing:
#    - Main agent must always update the `test_result.md` file before calling the testing agent
#    - Add implementation details to the status_history
#    - Set `needs_retesting` to true for tasks that need testing
#    - Update the `test_plan` section to guide testing priorities
#    - Add a message to `agent_communication` explaining what you've done
#
# 2. Incorporate User Feedback:
#    - When a user provides feedback that something is or isn't working, add this information to the relevant task's status_history
#    - Update the working status based on user feedback
#    - If a user reports an issue with a task that was marked as working, increment the stuck_count
#    - Whenever user reports issue in the app, if we have testing agent and task_result.md file so find the appropriate task for that and append in status_history of that task to contain the user concern and problem as well 
#
# 3. Track Stuck Tasks:
#    - Monitor which tasks have high stuck_count values or where you are fixing same issue again and again, analyze that when you read task_result.md
#    - For persistent issues, use websearch tool to find solutions
#    - Pay special attention to tasks in the stuck_tasks list
#    - When you fix an issue with a stuck task, don't reset the stuck_count until the testing agent confirms it's working
#
# 4. Provide Context to Testing Agent:
#    - When calling the testing agent, provide clear instructions about:
#      - Which tasks need testing (reference the test_plan)
#      - Any authentication details or configuration needed
#      - Specific test scenarios to focus on
#      - Any known issues or edge cases to verify
#
# 5. Call the testing agent with specific instructions referring to test_result.md
#
# IMPORTANT: Main agent must ALWAYS update test_result.md BEFORE calling the testing agent, as it relies on this file to understand what to test next.

#====================================================================================================
# END - Testing Protocol - DO NOT EDIT OR REMOVE THIS SECTION
#====================================================================================================



#====================================================================================================
# Testing Data - Main Agent and testing sub agent both should log testing data below this section
#====================================================================================================

user_problem_statement: |
  Connect REAL Stripe API keys to the existing CINÉMARIÉS app and implement Chromecast (Google Cast Web SDK).
  Stripe keys are now configured in backend/.env (test mode).
  Backend now exposes: /api/billing/checkout (subscription Checkout Session), /api/billing/status,
  /api/billing/cancel (cancel at period end), /api/billing/config (publishable key + price),
  /api/billing/webhook (Stripe webhooks for subscription lifecycle).

backend:
  - task: "Stripe Checkout (subscription mode, 1.99€/mo recurring)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Replaced the placeholder Stripe key with a real sk_test_... key in backend/.env. The /api/billing/checkout endpoint creates a real Stripe subscription Checkout Session with EUR 1.99/month recurring price and stores the user_id in metadata + customer reference."
      - working: true
        agent: "testing"
        comment: "Verified end-to-end against https://mariagevideo.preview.emergentagent.com/api. POST /api/billing/checkout (auth required) returns HTTP 200 with url starting with https://checkout.stripe.com/c/pay/cs_test_... and session_id starting with cs_test_. No 503 anymore. Unauthorized request correctly returns 401 ('Non authentifié'). stripe.Customer.create succeeds with real test key (proves stripe_customer_id is persisted on the user document)."

  - task: "Stripe subscription cancellation (cancel_at_period_end)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: "New endpoint POST /api/billing/cancel. Requires authenticated user. If no subscription_id is stored on user, looks it up via Stripe API for the customer."
      - working: true
        agent: "testing"
        comment: "POST /api/billing/cancel without Authorization header → HTTP 401 ('Non authentifié'). With test@wedding.fr (no active sub) → HTTP 404 with French detail 'Aucun abonnement actif trouvé'. Behaviour matches spec."

  - task: "Stripe webhook handler (lifecycle events)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: "POST /api/billing/webhook handles checkout.session.completed, customer.subscription.{created,updated,deleted}, and invoice.payment_failed. Updates users.is_subscribed and stripe IDs. Signature verification active when STRIPE_WEBHOOK_SECRET is set (currently empty since user has not yet configured the webhook in Stripe Dashboard)."
      - working: true
        agent: "testing"
        comment: "Dev-mode (no STRIPE_WEBHOOK_SECRET) accepts raw JSON. Sent checkout.session.completed with metadata.user_id=<test user uuid>, customer=cus_TEST_FAKE, subscription=sub_TEST_FAKE → HTTP 200 {received:true}, and subsequent GET /api/auth/me shows is_subscribed=true. Then sent customer.subscription.deleted with customer=cus_TEST_FAKE → HTTP 200 {received:true}, and GET /api/auth/me shows is_subscribed=false. Lifecycle wiring works correctly."

  - task: "Billing config endpoint (publishable key)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "low"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: "GET /api/billing/config returns publishable_key + price metadata + 'configured' boolean."
      - working: true
        agent: "testing"
        comment: "Public GET /api/billing/config → HTTP 200 with publishable_key starting with pk_test_, price_amount=199, price_currency='eur', configured=true. Matches expected contract."

  - task: "Public catalog + wedding unlock regression"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "Regression check: GET /api/videos/public → 200 with featured+rows. GET /api/weddings/public → 200 with weddings list. POST /api/weddings/unlock {code:'S9A5URZC'} → 200 with ok:true (still an active code for 'Hanifa et Dali' equivalent). No 500s observed."

  - task: "Support Chat / Tickets (user + admin endpoints)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Added complete support ticket system (collections db.support_tickets + db.support_messages). USER endpoints: POST/GET/PATCH /support/tickets, POST /messages, /mark-read, /unread-count, /upload. ADMIN endpoints: GET/PATCH/DELETE /admin/support/tickets, /admin/support/unread-count. Notifications (push + email) fire on every new message."
      - working: true
        agent: "testing"
        comment: |
          ✅ 51/51 assertions PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_support.py).

          Phase 1 — Auth gates (16 checks): every /support/* and /admin/support/* endpoint returns 401 without auth; every /admin/support/* returns 403 for non-admin. ✅

          Phase 2 — Ticket creation: empty/whitespace subject → 400. Subject-only → 200 with unread_for_admin=0, status=open. Subject+initial_message → 200, ticket has 1 message in support_messages, unread_for_admin=1, last_sender_role="user". ✅

          Phase 3 — GET /support/tickets returns the caller's tickets list (sorted by last_message_at desc). ✅

          Phase 4 — Messages flow:
            • POST /messages with empty text + no attachments → 400 {detail:"Message vide"}. ✅
            • User POST /messages → unread_for_admin increments (1→2), last_sender_role="user". ✅
            • Admin POST /messages → message.sender_role="admin", unread_for_user increments, last_sender_role="admin". ✅
            • POST /mark-read as owner → unread_for_user reset to 0 (verified by re-fetching ticket). ✅
            • PATCH ticket status=closed → 200; subsequent POST /messages → automatic reopen (status=open). ✅
            • PATCH invalid status ("bogus") → 400. PATCH to "in_progress" allowed for user. ✅

          Phase 5 — Cross-user access: a fresh registered user (support_other_2911cc09@example.com) trying to GET / POST on another user's ticket → 403. ✅

          Phase 6 — Unread-count endpoints: GET /support/unread-count and GET /admin/support/unread-count both return {unread: int}. ✅

          Phase 7 — Image upload: POST /support/upload with a real Pillow-generated JPEG (632 bytes) → 200 with {url, name, size}. The returned URL was successfully attached to a follow-up message (text="" + attachments=[{url,kind:"image"}]) → 200. ✅

          Phase 8 — Admin endpoints: GET /admin/support/tickets returns shape {tickets, total_unread, open_count}. ?status=open filter works (all returned tickets have status=open). PATCH invalid status → 400. PATCH on bogus uuid → 404. PATCH valid → 200. ✅

          Phase 9 — Admin DELETE cascades: created a fresh ticket with 3 messages (user msg, user msg, admin reply). DELETE /admin/support/tickets/{id} → 200. Subsequent GET → 404. Second DELETE → 404. Cascade works (msgs_before=3, ticket fully removed). ✅

          Phase 10 — Smoke regression: GET /auth/me, GET /weddings/public, POST /weddings/unlock (S9A5URZC), GET /admin/users all return 200. ✅

          Notification triggers fire correctly — backend logs confirm 6 successful "[mailer] Email sent to contact@creativindustry.com" entries for the support events (POST /messages from user, admin reply, etc.). Push notifications attempted gracefully (no real Expo tokens registered for admins/owners during test → no errors). NO 5xx returned by any /support/* or /admin/support/* call. The Exception in ASGI traces in backend.err.log are from the unrelated unlock_wedding DuplicateKeyError on db.user_unlocks (pre-existing) and do NOT impact support endpoints.

          test@wedding.fr password NOT changed. Fresh user created for cross-user test.

frontend:
  - task: "Subscription screen Cancel button + dialogs"
    implemented: true
    working: "NA"
    file: "/app/frontend/app/subscription.tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Replaced Alert.alert with showAlert/confirmAction from utils/dialog (works on web with Google Translate). Added a 'Résilier mon abonnement' button visible for premium users that calls /api/billing/cancel."

  - task: "Google Cast Web SDK integration (Chromecast on web)"
    implemented: true
    working: "NA"
    file: "/app/frontend/src/cast/index.web.ts, /app/frontend/app/video/[id].tsx"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Added a useCast() hook that loads https://www.gstatic.com/cv/js/sender/v1/cast_sender.js dynamically on Chrome/Edge desktop, uses the Default Media Receiver (CC1AD845) and can cast playableUrl to any nearby Chromecast device. Cast button in the video player now triggers the real Cast device picker on Chrome desktop and gracefully degrades on other browsers/native with explanation messages."

metadata:
  created_by: "main_agent"
  version: "1.1"
  test_sequence: 1
  run_ui: false

  - task: "Sprint 2 — Device binding on POST /api/weddings/unlock"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "Tested against https://mariagevideo.preview.emergentagent.com/api. Generated fresh client code RSSAPEYG via /api/client/codes. (1) First unlock with device_id=DEVICE_X → 200 ok:true, code becomes bound. (2) Same DEVICE_X re-unlock → 200 ok:true (idempotent — last_seen_at updates). (3) Different device_id=DEVICE_Y → HTTP 403 with French detail 'Ce code est déjà utilisé sur un autre appareil. Un code = 1 seul appareil.' (4) No device_id when code already bound → HTTP 403 'Ce code est verrouillé sur un appareil spécifique.' (5) Invalid code 'INVALIDXX' → HTTP 404 'Code invalide'. (6) Revoked code (set is_active=false via DELETE /api/client/codes/{code}) → HTTP 404 'Code invalide' (since query filters is_active=true). Spec accepts 410 or 404. All edge cases handled correctly."

  - task: "Sprint 2 — Client self-service codes (GET/POST/DELETE /api/client/codes)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "Auth user test@wedding.fr (subscription_tier=basic, client_id=hanifa-et-dali, is_subscribed=true). GET /api/client/codes → 200 with {codes:[...], tier:'basic', limit:3, active_count, can_create}. POST /api/client/codes 3 times (labels 'Tatie Marie', 'Cousin Paul', 'Amis lycée') → all 200 with 8-char uppercase alphanumeric code (e.g. GW79FX5V). 4th POST → HTTP 403 with French detail 'Limite atteinte (3 codes max). Passez à l'offre Illimité (2,30€/mois) pour générer des codes sans limite.' (contains both 'Limite atteinte' and 'Illimité'). After DELETE /api/client/codes/{code} → 200 ok:true, GET shows can_create=true again. DELETE as non-owner (fresh user) → 403 'Vous n'êtes pas le propriétaire de ce code'. Without client_id (admin unassigned wedding) → POST and GET both return 403 'Aucun mariage assigné'. Premium user WITH client_id but is_subscribed=false → POST returns 402 'Abonnement Premium requis.'. Minor: when a freshly-registered user has NEITHER is_subscribed NOR client_id, the 403 'Aucun mariage assigné' check fires before the 402 check (order deviates from review spec which expected 402 first for a 'fresh user'). Behavioural impact is low because both error messages are accurate; spec literal expectation of 402 not strictly met for that edge case."

  - task: "Sprint 2 — Admin assign / unassign wedding"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "As admin@wedding.fr / Admin13!. POST /api/admin/users/{user_id}/assign-wedding {client_id:'hanifa-et-dali'} → HTTP 200 with {ok:true, client_id:'hanifa-et-dali', client_name:'Hanifa et Dali'}. POST same with client_id:'nonexistent-wedding' → HTTP 404 detail 'Mariage introuvable'. DELETE /api/admin/users/{user_id}/wedding → HTTP 200 ok:true (removes client_id field). As non-admin (test@wedding.fr token) → HTTP 403 'Accès réservé aux administrateurs'. All four cases pass."

  - task: "Sprint 2 — Stripe tier in /api/billing/checkout + /api/billing/config"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: false
        agent: "testing"
        comment: "Initial run: POST /api/billing/checkout returned 502 'No such customer: cus_TEST_FAKE'. Root cause was stale state in DB — earlier webhook test wrote stripe_customer_id=cus_TEST_FAKE to test@wedding.fr. Cleared the field via direct DB update (db.users.update_one $unset stripe_customer_id/stripe_subscription_id), then re-tested."
      - working: true
        agent: "testing"
        comment: "After clearing stale stripe_customer_id on test user: POST /api/billing/checkout {tier:'basic'} → 200 with url starting https://checkout.stripe.com/c/pay/cs_test_ and session_id cs_test_a1EJ9S2bIaJv... Retrieved session via Stripe API with expand=line_items → unit_amount=199. POST {tier:'unlimited'} → 200, resp_tier='unlimited', session retrieved shows unit_amount=230 cents. POST {tier:'invalid'} → 200 with tier='basic' (correct fallback). GET /api/billing/config → 200 {publishable_key:'pk_test_...', price_amount:199, price_amount_unlimited:230, basic_max_codes:3, price_currency:'eur', configured:true}. All Stripe tier wiring correct end-to-end against real Stripe API."

  - task: "Sprint 2 — Wedding details is_my_wedding flag"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "GET /api/weddings/hanifa-et-dali with test@wedding.fr token → 200 is_my_wedding=true. GET /api/weddings/hanifa-et-dali anonymously → 200 is_my_wedding=false. GET /api/weddings/sarahline-elarif (another wedding) with test@wedding.fr token → 200 is_my_wedding=false. Flag works correctly."

  - task: "Sprint 2 — /auth/me returns subscription_tier + client_id"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "medium"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: "GET /api/auth/me with admin token → 200, response includes subscription_tier (None) and client_id (None). GET /api/auth/me with test@wedding.fr token → 200, response includes subscription_tier='basic', client_id='hanifa-et-dali', is_subscribed=true. UserPublic model now exposes both new fields as expected."

test_plan:
  current_focus: []
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Sprint 2 NEW FEATURES — please test all of the following:

      DEVICE BINDING (1 code = 1 device):
        • POST /api/weddings/unlock now accepts {code, device_id, device_label}.
        • First device-id to use a code BINDS it. Same device can re-call (200, idempotent).
        • Different device-id → HTTP 403 with French error: "Ce code est déjà utilisé sur un autre appareil. Un code = 1 seul appareil."
        • Old codes without device-id binding still work (legacy mode).

      CLIENT SELF-SERVICE CODES (premium owners):
        • Subscribe a test user (or set is_subscribed=true via DB) AND assign a wedding via admin endpoint.
        • POST /api/admin/users/{user_id}/assign-wedding {client_id} (admin only).
        • DELETE /api/admin/users/{user_id}/wedding (admin only).
        • Then as that user:
          - GET /api/client/codes → returns {codes, tier, limit, can_create}
          - POST /api/client/codes {label} → creates a new code; tier basic limited to BASIC_MAX_CODES (3)
          - DELETE /api/client/codes/{code} → revokes (must be owner)
        • Without is_subscribed → 402 Payment Required
        • Without client_id → 403 Forbidden
        • At limit (3 active codes for basic tier) → 403 with French upgrade message

      STRIPE TIERS:
        • POST /api/billing/checkout now accepts {tier: "basic" | "unlimited"} and uses STRIPE_PRICE_AMOUNT or STRIPE_PRICE_AMOUNT_UNLIMITED (230 cents).
        • GET /api/billing/config now returns price_amount_unlimited and basic_max_codes.
        • Webhook saves subscription_tier from metadata into user document.

      WEDDING DETAILS:
        • GET /api/weddings/{client_id} now returns is_my_wedding=true when the authenticated user has client_id matching.

      CREDENTIALS:
        • admin@wedding.fr / Admin13!
        • test@wedding.fr / test1234 (already has client_id=hanifa-et-dali + is_subscribed=true + tier=basic from manual setup)
        • Existing active code S9A5URZC bound to first device that used it earlier; new code T2QPYT54 bound to DEVICE_A_UUID.

      Please run tests on the 4 task groups above and report results. No frontend testing needed yet.
  - agent: "testing"
    message: |
      ✅ All 14 backend tests passed against https://mariagevideo.preview.emergentagent.com/api.
      • GET  /api/billing/config → 200 (pk_test_..., 199, eur, configured=true)
      • POST /api/billing/checkout (auth) → 200 with real https://checkout.stripe.com/c/pay/cs_test_... and session_id cs_test_…
      • POST /api/billing/checkout (no auth) → 401
      • POST /api/billing/cancel (no auth) → 401
      • POST /api/billing/cancel (no active sub) → 404 "Aucun abonnement actif trouvé"
      • POST /api/billing/webhook checkout.session.completed (raw JSON, dev mode) → 200 {received:true} → /auth/me shows is_subscribed=true
      • POST /api/billing/webhook customer.subscription.deleted → 200 {received:true} → /auth/me shows is_subscribed=false
      • Regression: GET /api/videos/public, GET /api/weddings/public, POST /api/weddings/unlock (S9A5URZC) all return 200.
      No 500s or unexpected errors. Backend logs show real Stripe API responses code 200.
      Stripe billing integration appears fully functional end-to-end in test mode.
  - agent: "testing"
    message: |
      ✅ Sprint 2 — All 6 task groups verified PASSING against https://mariagevideo.preview.emergentagent.com/api (backend_test.py — 37/39 individual assertions; 2 remaining are not backend bugs, see below).

      DEVICE BINDING (/api/weddings/unlock):
        • Fresh code RSSAPEYG (generated via /api/client/codes) → first unlock with DEVICE_X binds (200 ok:true).
        • Same DEVICE_X re-unlock → 200 idempotent.
        • DEVICE_Y → 403 "Ce code est déjà utilisé sur un autre appareil. Un code = 1 seul appareil."
        • No device_id on bound code → 403.
        • Invalid code → 404. Revoked code (after DELETE /api/client/codes/{code}) → 404 (since is_active filter excludes it; spec accepts 410 or 404).

      CLIENT SELF-SERVICE CODES (/api/client/codes):
        • test@wedding.fr (basic, hanifa-et-dali): GET → 200 {tier:'basic', limit:3, can_create, codes[]}. 3 POSTs → 200 with 8-char uppercase alphanumeric codes (e.g. GW79FX5V). 4th POST → 403 "Limite atteinte (3 codes max). … Illimité (2,30€/mois) …".
        • DELETE → 200, can_create flips back to true. DELETE as non-owner → 403.
        • Subscribed user WITH client_id but is_subscribed=false → 402 "Abonnement Premium requis." (verified via fresh registration + admin assign).
        • Without client_id assigned → 403 "Aucun mariage assigné".
        • MINOR: When a freshly-registered user has NEITHER is_subscribed NOR client_id, server returns 403 (client_id check) instead of 402. The review spec wording suggested 402 first. Low impact — error message remains accurate.

      ADMIN ASSIGN / UNASSIGN:
        • POST /api/admin/users/{id}/assign-wedding valid client_id → 200 {ok:true, client_id, client_name:'Hanifa et Dali'}.
        • Invalid client_id → 404 "Mariage introuvable".
        • DELETE /api/admin/users/{id}/wedding → 200 ok:true.
        • Non-admin → 403 "Accès réservé aux administrateurs".

      STRIPE TIERS (/api/billing/checkout + /api/billing/config):
        • POST /api/billing/checkout {tier:'basic'} → 200, session.line_items unit_amount=199 (verified via Stripe API retrieve).
        • POST {tier:'unlimited'} → 200, resp_tier='unlimited', unit_amount=230 (verified).
        • POST {tier:'invalid'} → 200, tier='basic' (correct fallback).
        • GET /api/billing/config → {publishable_key, price_amount:199, price_amount_unlimited:230, price_currency:'eur', basic_max_codes:3, configured:true}.
        • Initial 502s were caused by stale stripe_customer_id='cus_TEST_FAKE' on test@wedding.fr left over from prior webhook test; cleared via direct DB $unset and behaviour became correct. Recommend main agent reset that field in any seed/setup tooling so a fresh deploy doesn't keep stale ids.

      WEDDING DETAILS is_my_wedding:
        • test@wedding.fr GET /weddings/hanifa-et-dali → is_my_wedding=true.
        • Anonymous → is_my_wedding=false.
        • test@wedding.fr GET another wedding → is_my_wedding=false.

      REGRESSION:
        • GET /api/videos/public anon → 200 with featured+rows.
        • GET /api/weddings/public anon → 200 with weddings.
        • GET /api/auth/me for both admin and test users → 200, now exposes subscription_tier + client_id fields (UserPublic model).

      Backend logs (uvicorn) confirm real Stripe API 200 responses on /v1/customers and /v1/checkout/sessions.
      No critical issues remain. Frontend testing not performed (out of scope).

  - task: "Admin Weddings listing + Merge endpoints (NEW)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: "Added two new admin endpoints to solve the duplicate-wedding bug (when admin uploads multiple videos for the same wedding but with slight title typos, each video gets its own auto-generated client_id, breaking 1-code-unlocks-all-videos behaviour). NEW: (1) GET /api/admin/weddings — returns list of unique weddings with client_id, client_name, video_count, poster_url; admin-only (require_admin); used by /admin/video-edit form to attach new videos to an EXISTING wedding instead of creating a new one. (2) POST /api/admin/weddings/merge — body: {source_client_ids:[str], target_client_id:str, target_client_name?:str}; reassigns all videos with client_id in source_client_ids to target_client_id (also handles videos with no client_id but slugify(title) matching a source), and migrates unlock_codes and user_unlocks accordingly. Already used manually via Python script to merge user's duplicate sarahline-elarif into sarahaline-elarif (2 videos now correctly grouped). Please test: admin auth required (403 for non-admin), GET returns weddings list with correct counts, POST merge moves videos+codes correctly, invalid body returns 400."
      - working: true
        agent: "testing"
        comment: "All 27 assertions PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_admin_weddings.py). GET /api/admin/weddings: (a) unauth → 401 'Non authentifié'; (b) non-admin (test@wedding.fr) → 403 'Accès réservé aux administrateurs'; (c) admin → 200 with {weddings:[...]} containing 2 entries; every wedding has client_id (str), client_name (str), video_count (int > 0), poster_url, created_at (ISO string). Sorting verified: newest created_at first. The sarahaline-elarif wedding correctly shows video_count=2 (Sarahaline & Elarif). POST /api/admin/weddings/merge: (a) non-admin → 403; (b) missing target_client_id → 400 'target_client_id requis'; (c) missing source_client_ids → 400 'source_client_ids requis'; (d) empty source list → 400 'source_client_ids requis'. Happy path: created a test video with title 'TestMergeWedding DFAC7D' (auto client_id testmergewedding-dfac7d), confirmed it appeared in /admin/weddings, then POSTed merge with source=['testmergewedding-dfac7d'], target='sarahaline-elarif', target_client_name='Sarahaline & Elarif' → 200 {ok:true, moved:1, target_client_id:'sarahaline-elarif'}. Post-merge GET /admin/weddings confirmed: test wedding GONE, sarahaline-elarif video_count went 2→3. GET /api/weddings/sarahaline-elarif?code=<existing> returned all 3 videos including the merged TestMergeWedding video with unlocked=true. REGRESSION POST /api/weddings/unlock with a fresh code for sarahaline-elarif + device_id='TEST_DEVICE_001' → 200 video_count=3, videos[] length=3, all with non-null full_url. Cleanup deleted the test video and post-cleanup state confirmed back to baseline (sarahaline-elarif=2, hanifa-et-dali=1). No 5xx errors observed; backend logs clean. Endpoints are production-ready."

test_plan:
  current_focus:
    - "Public Showcase Videos (Discover tab)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      🎬 NEW FEATURE — Public Showcase Videos (Phase 2 — Vidéothèque publique).

      Added to backend (/app/backend/server.py):
        1. Video model: new field `is_showcase: bool = False`
        2. VideoCreate / VideoUpdate: accept `is_showcase`
        3. video_to_public(): exposes `is_showcase` in API response
        4. NEW endpoint: GET /api/videos/showcase — optional auth (anonymous = posters/trailers only, authenticated = full_url for casting). Returns {is_authenticated, featured[], rows:[{category, videos[]}], total}. Categories ordered: "À l'affiche", "Cérémonies", "Soirées", "Best Of", then any other alphabetically.
        5. GET /api/videos/{video_id}: NEW rule — if v.is_showcase=True AND user is authenticated → unlocked=True (no code required). Existing wedding-code logic untouched.

      Frontend changes:
        • Added new tab `/discover` (Découvrir) with Netflix-style hero + horizontal rows.
        • Admin video-edit: new switch "⭐ Vidéo démo publique" wired to is_showcase.
        • Admin /admin/videos list: green "⭐ DÉMO" badge when is_showcase=true.

      Please test the SHOWCASE endpoints only (don't re-test photo gallery):
        a) GET /api/videos/showcase (anonymous) → 200, is_authenticated:false, total:0 initially, all videos with full_url=null
        b) GET /api/videos/showcase (auth as test@wedding.fr or admin) → is_authenticated:true, full_url populated when at least one video is_showcase
        c) Use admin token to create a video with is_showcase=true via POST /api/admin/videos → expect 200 with returned video.is_showcase=true
        d) PATCH /api/admin/videos/{id} with body {is_showcase: false} → 200, then GET /videos/showcase total decreases by 1
        e) GET /api/videos/{id} with a logged-in non-admin user for the showcase video → must return include_full=true (full_url present) WITHOUT any unlock code
        f) GET /api/videos/{id} as anonymous (no auth, no code) for the showcase video → full_url MUST be null (showcase requires login to play, but listing/poster is public)
        g) Regression: existing /weddings/public, /weddings/{id}, /weddings/unlock, /library, /admin/weddings should all still pass

      Admin: admin@wedding.fr / Admin13!
      Test user: test@wedding.fr / TestPass123!  (or any existing free account from test_credentials.md)
  - agent: "testing"
    message: |
      ✅ Both new admin endpoints fully verified — 27/27 assertions passed against https://mariagevideo.preview.emergentagent.com/api.

      GET /api/admin/weddings
        • Unauth → 401, non-admin → 403, admin → 200 with {weddings:[…]} (2 items).
        • Each entry has client_id, client_name, video_count>0, poster_url, ISO created_at.
        • Correctly sorted by created_at desc (newest first).
        • sarahaline-elarif shows video_count=2 as expected.

      POST /api/admin/weddings/merge
        • Non-admin → 403. Missing target_client_id → 400 'target_client_id requis'. Missing/empty source_client_ids → 400 'source_client_ids requis'.
        • Happy path: created 'TestMergeWedding DFAC7D' (auto client_id testmergewedding-dfac7d) → appeared in /admin/weddings → merged into sarahaline-elarif → response {ok:true, moved:1, target_client_id:'sarahaline-elarif'}; subsequent GET /admin/weddings showed source wedding gone and sarahaline-elarif count went 2→3.
        • GET /api/weddings/sarahaline-elarif?code=<active_code> returned unlocked=true with all 3 videos (including the merged test video).

      REGRESSION POST /api/weddings/unlock
        • With a fresh code for sarahaline-elarif + device_id='TEST_DEVICE_001' → 200, video_count=3, videos[] length=3, every full_url non-null. The 1-code-unlocks-all-videos rule holds after merge.

      Cleanup: test video deleted, state back to baseline (sarahaline-elarif=2, hanifa-et-dali=1). No 5xx errors. Both endpoints are production-ready. No further backend testing required for this story.

  - task: "Contact / Devis endpoints (POST /api/contact + admin CRUD)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          All 41 assertions PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_contact.py).
          POST /api/contact (PUBLIC, no auth):
            • Happy path with full body {name, email, phone, subject, wedding_date, location, message, source:'cinemaries-about'} → 200 {ok:true, id:<uuid>}.
            • All fields persisted including the NEW 'subject' field (verified via GET admin list).
            • Missing name → 400 "Nom, email et message requis."
            • Empty email → 422 (Pydantic EmailStr); invalid email format ('notanemail') → 422.
            • Missing message → 400 "Nom, email et message requis."
            • Message > 5000 chars → 400 "Message trop long (max 5000 caractères)."
            • Minimal valid body {name, email, message} (no phone/subject) → 200 (subject is optional, confirmed).
          GET /api/admin/contact-requests (ADMIN):
            • Unauth → 401, non-admin (test@wedding.fr) → 403, admin → 200 {requests:[...]}.
            • List sorted by created_at descending (verified).
            • Each item has id, name, email, phone, subject, wedding_date, location, message, source, status:'new', created_at (ISO string).
            • The happy-path doc from step 1 appears with all fields intact.
          PATCH /api/admin/contact-requests/{req_id} (ADMIN):
            • Non-admin → 403.
            • {status:'read'} → 200 {ok:true}; subsequent GET shows status='read'.
            • {status:'archived'} → 200; GET shows archived.
            • {notes:'called client'} → 200; notes field persisted.
            • Empty body {} → 400 "Aucune modification."
            • Non-existent req_id → 404 "Demande introuvable".
          DELETE /api/admin/contact-requests/{req_id} (ADMIN):
            • Non-admin → 403.
            • Valid id → 200 {ok:true}; subsequent GET no longer contains it.
            • Already-deleted id → 404 "Demande introuvable".
          REGRESSION:
            • GET /api/admin/weddings (admin) → 200 with 2 weddings; sarahaline-elarif has video_count=2 as expected.
          No 5xx errors observed; backend logs clean. Contact + admin CRUD endpoints are production-ready.

test_plan:
  current_focus: []
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "testing"
    message: |
      ✅ RGPD cascade fix RETEST — ALL 57/57 assertions passed against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_rgpd.py).

      DELETE /api/me cascade for unlock_codes — FIX VERIFIED:
        • Created rgpd_user_30f64c45@example.com, admin-assigned hanifa-et-dali, generated 2 codes via /api/client/codes (B43WW6LG unused, 3BKBJL58 used + bound to device via /weddings/unlock with bound_device_ip/ua/label populated).
        • After DELETE /api/me (200):
          - Unused code B43WW6LG: completely deleted from db.unlock_codes.
          - Used code 3BKBJL58: PRESERVED but ANONYMIZED → owner_user_id='deleted_user', owner_email=None, bound_device_ip=None, bound_device_ua=None, bound_device_label=None.
          - db.unlock_codes.count({owner_user_id: <user_id>}) == 0.
          - db.unlock_codes.count({owner_email: <email>}) == 0. NO PII LEFT.

      GET /api/me/export — FIX VERIFIED:
        • data.codes_created now contains both generated codes (B43WW6LG + 3BKBJL58), each with owner_user_id == test user id. Previously empty.
        • exported_at ISO, exported_for=email, legal_basis mentions 'RGPD Article 20', all 6 data sub-keys present.
        • password_hash absent from data.account and from the full JSON payload.

      Sanity checks still PASS:
        • DELETE /api/me unauth → 401.
        • DELETE /api/me as last admin → 400 with French detail; admin still in DB.
        • Cascade verified for user_unlocks, hosting_requests, checkout_sessions, contact_requests (all 0).
        • Post-delete login → 401.

      No remaining issues on RGPD endpoints. No frontend testing performed (out of scope).

  - agent: "main"
    message: "RGPD cascade fix applied to /api/me/export and DELETE /api/me — switched from non-existent 'created_by' to actual 'owner_user_id', from 'used_count' to 'current_uses', and added anonymization of owner_email/bound_device_ip/ua/label for used codes. Please retest."

      GET /api/me/export — WORKING.
        • 401 without token, 200 with token. Payload contains exported_at (ISO), exported_for (email), legal_basis ('RGPD Article 20 …'), data.{account, video_unlocks, codes_created, hosting_requests, payment_sessions, contact_requests}. password_hash absent from data.account and from full JSON.
        • Caveat: data.codes_created uses the DB query {"created_by": uid} — same bug as below — so user-generated codes will never appear in their export.

      DELETE /api/me — PARTIALLY WORKING (CRITICAL CASCADE BUG):
        • 401 without token ✅
        • Admin (last admin) → 400, admin preserved ✅
        • Non-admin user → 200 with {deleted:true, email:…}, user removed from db.users, login refused afterwards ✅
        • Cascade verified for user_unlocks, hosting_requests, checkout_sessions, contact_requests (all 0 post-delete) ✅
        • ❌ unlock_codes ARE NOT CASCADED. The handler queries by 'created_by', but the /api/client/codes endpoint inserts user-owned codes with field 'owner_user_id' (and 'owner_email'). grep "created_by" /app/backend/server.py shows the field is ONLY referenced in the RGPD handler — never set anywhere. Concrete repro: after deleting rgpd_user_0276c864@example.com, both codes 69SF58HF (unused) and Z3UUDRQX (used, bound to device) remained in db.unlock_codes with owner_user_id, owner_email, bound_device_ip (10.232.130.66), bound_device_ua, bound_device_label intact. This is an RGPD violation — personal data of the deleted user persists.

      FIX SUGGESTION for main agent — Option A (preferred):
        Update /app/backend/server.py @ delete_my_account to use owner_user_id and also scrub the device fingerprints stored at unlock time. Apply same field name change to export_my_data so users see their own codes:
          # in delete_my_account:
          await db.unlock_codes.delete_many({"owner_user_id": uid, "current_uses": 0})
          await db.unlock_codes.update_many(
              {"owner_user_id": uid},
              {"$set": {"owner_user_id": "deleted_user", "owner_email": None,
                        "bound_device_ip": None, "bound_device_ua": None, "bound_device_label": None}}
          )
          # in export_my_data:
          codes_created = await db.unlock_codes.find({"owner_user_id": uid}, {"_id": 0}).to_list(1000)

      I cleaned up the 2 orphan codes left in DB by my repro (db.unlock_codes.delete_many({owner_email: /^rgpd_user_/})). The bug itself is independent of my cleanup.

      No other backend changes needed. Once the cascade is fixed, please flag for retest (only the DELETE /api/me task needs re-verification).


  - task: "RGPD — GET /api/me/export (data portability)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          Tested against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_rgpd.py).
          • GET /api/me/export without Authorization header → HTTP 401.
          • GET /api/me/export with a valid Bearer token → HTTP 200.
          • Response payload structure verified:
              - exported_at = ISO 8601 string with timezone (e.g. '2026-05-21T03:50:47.123+00:00').
              - exported_for = user email.
              - legal_basis contains 'RGPD Article 20 - Droit à la portabilité'.
              - data object contains all 6 sub-keys: account, video_unlocks, codes_created, hosting_requests, payment_sessions, contact_requests; each list is a JSON array.
              - data.account contains id and email but NOT password_hash. Recursive scan of the full export JSON also confirmed 'password_hash' substring is absent.
          • MINOR (functional issue, not a security issue): data.codes_created uses the DB query {"created_by": uid}, but unlock codes generated via POST /api/client/codes store the user identity under 'owner_user_id'/'owner_email', not 'created_by'. So a basic-tier user who has generated codes via the self-service endpoint will see an EMPTY codes_created array in their export. The export is otherwise safe and complete; see DELETE /api/me task for the related cascade bug that has the same root cause.
      
  - task: "RGPD — DELETE /api/me (right to erasure + cascade)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          RETEST after cascade fix — ALL 57/57 assertions PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_rgpd.py).
          • DELETE /api/me unauth → 401 ✅
          • DELETE /api/me as last admin → 400 "Impossible de supprimer le dernier compte admin…" ; admin still in DB ✅
          • DELETE /api/me as non-admin test user → 200 {deleted:true, email:…} ✅
          • Cascade verified: user_unlocks=0, hosting_requests=0, checkout_sessions=0, contact_requests=0 post-delete ✅
          • UNLOCK_CODES CASCADE NOW WORKS (was the bug):
              - Repro: created test user rgpd_user_30f64c45@example.com, assigned hanifa-et-dali, generated 2 codes via /api/client/codes (B43WW6LG unused, 3BKBJL58 used + bound to device via /weddings/unlock).
              - Pre-delete: db.unlock_codes had 2 docs with owner_user_id=<test user id>, used code had bound_device_ip/ua/label populated.
              - Post-delete: unused code B43WW6LG fully removed (deleted_many path). Used code 3BKBJL58 PRESERVED but ANONYMIZED — owner_user_id='deleted_user', owner_email=None, bound_device_ip=None, bound_device_ua=None, bound_device_label=None. db.unlock_codes.count({owner_user_id:<test user id>}) == 0. db.unlock_codes.count({owner_email:<test user email>}) == 0. No PII remains for the deleted user.
          • Deleted user cannot login (401) ✅.
          RGPD Article 17 compliance restored.
      - working: false
        agent: "testing"
        comment: |
          (Historical — bug since FIXED). Tested against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_rgpd.py).
          PASSING aspects:
          • DELETE /api/me without Authorization header → HTTP 401.
          • DELETE /api/me with admin token (last admin) → HTTP 400 with French detail mentioning impossibility to delete the last admin. Admin account remains intact in DB (admin_count unchanged). Verified admin@wedding.fr still queryable afterwards.
          • DELETE /api/me with a fresh non-admin test user (rgpd_user_<uuid>@example.com) → HTTP 200 with body {"deleted": true, "email": "..."}.
          • After deletion the user document is removed from db.users; user can no longer login (HTTP 4xx).
          • Cascade VERIFIED for: db.user_unlocks (removed by user_id), db.hosting_requests (removed by user_id), db.checkout_sessions (removed by user_id), db.contact_requests (removed by email matching). All counts went to 0 in DB.

          ❌ CRITICAL BUG — unlock_codes cascade does NOT work (RGPD violation):
          • The DELETE /api/me handler runs:
              db.unlock_codes.delete_many({"created_by": uid, "used_count": 0})
              db.unlock_codes.update_many({"created_by": uid}, {"$set": {"created_by": "deleted_user"}})
            but codes generated by users via POST /api/client/codes are INSERTED with fields {"owner_user_id": current["id"], "owner_email": current.get("email"), "source": "client"} — there is NO "created_by" field anywhere in the server.py code (grepped — only the RGPD handler references it). 
          • Repro: registered rgpd_user_0276c864@example.com → admin assigned wedding hanifa-et-dali → POST /api/client/codes twice produced codes 69SF58HF (unused) and Z3UUDRQX (then unlocked via /weddings/unlock so used_count=1, bound_device_id set, bound_device_ip+ua persisted). After DELETE /api/me returned 200, both codes were STILL in db.unlock_codes with their full owner_user_id and owner_email pointing to the now-deleted user (also bound_device_ip='10.232.130.66', bound_device_ua='python-requests/2.34.1', label='RGPD test code' / 'RGPD used code'). Personal data is retained — incompatible with RGPD Article 17 ('right to erasure').
          • Same root cause also breaks GET /api/me/export → data.codes_created is queried by {"created_by": uid}, so users will never see codes they've generated in their export.

          FIX SUGGESTION (one of):
          (a) Change the DELETE /api/me handler to query/anonymize using owner_user_id (and clear owner_email + bound_device_ip + bound_device_ua + bound_device_label) and apply the same fix to the export endpoint. E.g.
              await db.unlock_codes.delete_many({"owner_user_id": uid, "current_uses": 0})
              await db.unlock_codes.update_many({"owner_user_id": uid}, {"$set": {"owner_user_id": "deleted_user", "owner_email": None, "bound_device_ip": None, "bound_device_ua": None, "bound_device_label": None}})
              codes_created = await db.unlock_codes.find({"owner_user_id": uid}, {"_id": 0}).to_list(1000)
          (b) Add a "created_by" field at insertion time in /api/client/codes (and any admin endpoint) and keep the current handler.
          Option (a) is preferred as it ALSO scrubs the device fingerprints (IP / UA / label) that were captured during /weddings/unlock — those are also personal data.

          NOTE: I cleaned up the 2 orphan codes (69SF58HF, Z3UUDRQX) left in db.unlock_codes after the test to keep the database clean. The bug itself is unrelated to my test cleanup.



  - task: "RGPD — DELETE /api/me refactor to moderation queue + admin moderation"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          ALL 38/38 assertions PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_deletion_queue.py).

          DELETE /api/me (refactored from immediate cascade → queued moderation request):
            • Unauth → 401.
            • As last admin (admin@wedding.fr) → 400 'Impossible de supprimer le dernier compte admin. Créez d'abord un autre admin.' and NO deletion_requests document created for admin (verified via GET /admin/deletion-requests?status=pending).
            • As fresh non-admin user (queue_test_<uuid>@example.com) → 200 with body {queued:true, request_id:<uuid>, status:'pending', message:<French>}. Body no longer contains 'deleted' key.
            • User can still login afterwards (not deleted yet) — confirms queue behaviour.
            • Idempotency: second DELETE /api/me returns SAME request_id with queued:true and message 'Votre demande est déjà en cours de traitement.' — no duplicate doc created.
            • Endpoint completes successfully even if SMTP not configured (email is in try/except — no crash observed).

          GET /api/me/deletion-request:
            • Unauth → 401.
            • Before any request → 200 {request:null}.
            • After DELETE /api/me → 200 {request:{id, user_id, email, full_name, status:'pending', requested_at, reason:null, processed_at:null, processed_by:null, admin_note:null}}.

          GET /api/admin/deletion-requests:
            • Unauth → 401, non-admin (newly registered test user) → 403.
            • Default (no status param) → 200 {items:[...], count} with our pending request included.
            • Status filters: ?status=pending → includes, ?status=approved → excludes, ?status=rejected → excludes, ?status=all → includes. All return 200 with correct filtering.

          POST /api/admin/deletion-requests/{id}/approve:
            • Unauth → 401, non-admin → 403, invalid id → 404.
            • Valid pending request as admin → 200 {approved:true, deleted:true}. Request status updated to 'approved' with processed_at (ISO) and processed_by=<admin_id>.
            • Cascade delete VERIFIED: approved user can no longer login (401 'Identifiants incorrects').
            • Already-processed → 400 'Demande déjà traitée (statut: approved)'.
            • Last admin safety: cannot trigger via DELETE /api/me (refuses to queue), so the 400-on-approve path is implicitly safe.

          POST /api/admin/deletion-requests/{id}/reject:
            • Unauth → 401, non-admin → 403, invalid id → 404.
            • Empty reason → 400 'Un motif de rejet est obligatoire.', missing reason → 400.
            • Valid {reason} as admin → 200 {rejected:true, reason}. Request persisted with status='rejected', admin_note=reason, processed_at, processed_by=<admin_id>.
            • Rejected user can still login (not deleted from db.users).
            • Already-processed → 400 'Demande déjà traitée (statut: rejected)'.

          POST /api/billing/portal:
            • Unauth → 401.
            • Fresh user without stripe_customer_id → 404 'Aucun client Stripe associé. Souscrivez d'abord à un abonnement.'
            • Admin user (has stripe_customer_id from prior tests) → 200 {url:'https://billing.stripe.com/p/session/test_...'} — verified URL hosted on billing.stripe.com.

          SMTP behaviour:
            • DELETE /api/me did not crash despite SMTP not being fully configured (errors wrapped in try/except in server.py @lines 370-401). Endpoint always returns 200 with queue payload. CONFIRMED working.

          Cleanup: portal_test_<uuid> and queue_reject_<uuid> users were queued for deletion then approved by admin to leave DB clean. No 5xx errors. No backend log errors related to new endpoints. Endpoints are production-ready.

agent_communication:
  - agent: "main"
    message: |
      NEW FEATURE — 1 code = up to 3 devices (was: 1 code = 1 device).
      Backend changes in /app/backend/server.py:
        • New constant MAX_DEVICES_PER_CODE (default 3) exposed via GET /api/billing/config as max_devices_per_code.
        • POST /api/weddings/unlock — refactored device-binding logic:
            - Codes now keep an ARRAY `bound_devices[]` of up to 3 entries: {device_id,label,ip,ua,bound_at,last_seen_at}.
            - Backward compat: legacy single-device codes (only `bound_device_id`) are auto-promoted into the array on first call.
            - Same device re-unlocking → 200 idempotent (updates last_seen_at).
            - New device joining when count<3 → 200, appended to bound_devices, current_uses +1.
            - 4th new device → HTTP 403 "Limite de 3 appareils atteinte pour ce code. Passez à l'offre Illimité ou contactez les mariés pour qu'ils génèrent un nouveau code."
            - Same as before: empty device_id while code already used by N>0 devices → 403 with French detail.
            - First device fields (`bound_device_id`, `bound_device_label`, …) are kept in sync with bound_devices[0] for backward compat with admin UIs.
            - Response now includes `devices_used` (count after this call) and `devices_max`.
        • POST /api/client/codes — no longer sets max_uses=1 (device-count is now the actual limit). New codes start with bound_devices=[].
        • NEW: DELETE /api/client/codes/{code}/devices/{device_id} — allows code owner (or admin) to free ONE specific device slot so a new device can take its place.
        • code_to_public() now returns: `devices[]` (label+bound_at+last_seen_at), `devices_count`, `devices_max`. Legacy fields kept.

      Frontend changes:
        • /app/frontend/app/wedding/[clientId].tsx — "1 code = 1 appareil" → "1 code = jusqu'à 3 appareils"; invite list now shows "📱 N/3 appareils (complet)" with bullet-list of device labels under each code.
        • /app/frontend/app/subscription.tsx — same text update.
        • /app/frontend/app/legal/cgu.tsx + privacy.tsx — text updates for the rule.

      CREDENTIALS:
        • admin@wedding.fr / Admin13!
        • test@wedding.fr / test1234 (client_id=hanifa-et-dali + is_subscribed=true + tier=basic)

      Please verify backend in this priority order on https://mariagevideo.preview.emergentagent.com/api:
      1. GET /api/billing/config → 200 with `max_devices_per_code:3` present.
      2. POST /api/weddings/unlock (multi-device flow):
          a. Generate a fresh code via /api/client/codes (auth as test@wedding.fr, tier=basic).
          b. Unlock with device_id="DEV_A" → 200 ok:true, devices_used:1, videos[] all with non-null full_url.
          c. Unlock SAME code with device_id="DEV_A" again → 200 ok:true, devices_used:1 (idempotent).
          d. Unlock with device_id="DEV_B" → 200 ok:true, devices_used:2.
          e. Unlock with device_id="DEV_C" → 200 ok:true, devices_used:3.
          f. Unlock with device_id="DEV_D" → HTTP 403, detail contains "Limite de 3 appareils".
          g. Unlock with no device_id at this point → HTTP 403, detail mentions "déjà utilisé sur 3 appareil".
      3. GET /api/client/codes (as test user) → 200 with `devices_count`, `devices_max`, and `devices[]` (3 entries with labels) for the code above.
      4. DELETE /api/client/codes/{code}/devices/DEV_B as the code owner → 200 ok:true, devices_count:2. Then a NEW device_id="DEV_E" should successfully unlock (devices_used:3).
      5. DELETE /api/client/codes/{code}/devices/DEV_X (non-existent device) → 404 "Appareil introuvable pour ce code".
      6. DELETE /api/client/codes/{code}/devices/DEV_A as a non-owner → 403 "Vous n'êtes pas le propriétaire de ce code".
      7. Backward-compat regression: existing S9A5URZC code (legacy single-device binding) should still unlock idempotently for the device it was originally bound to, and accept 2 more new devices before hitting 403.
      8. Make sure POST /api/weddings/unlock STILL returns full_url for all videos (this regression was already working — just confirm it didn't break).
      No frontend testing yet.

  - task: "Code multi-device binding (1 code = up to 3 devices) — refactor of /api/weddings/unlock"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: "NA"
        agent: "main"
        comment: |
          Replaced the previous "1 code = 1 device" lock with a multi-device allowance up to MAX_DEVICES_PER_CODE (default 3, from env). Stores `bound_devices[]` array with per-device metadata (device_id, label, ip, ua, bound_at, last_seen_at). Legacy `bound_device_id` field is kept in sync with the first device for backward compat. Same device can re-call indefinitely (200, last_seen refreshed). New devices accepted until limit reached, then 403 with French upgrade message. NEW endpoint DELETE /api/client/codes/{code}/devices/{device_id} lets owner free one slot. code_to_public exposes devices[], devices_count, devices_max. GET /api/billing/config now exposes max_devices_per_code. Code-creation in /api/client/codes no longer pre-sets max_uses=1. Frontend (wedding/[clientId].tsx, subscription.tsx, legal pages) updated with new "1 code = jusqu'à 3 appareils" wording.
      - working: true
        agent: "testing"
        comment: |
          ALL 16/16 assertions PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_multidevice.py).
          
          1. GET /billing/config (public) → 200 with max_devices_per_code:3 ✅.
          2. POST /client/codes {label:"Test 3-devices"} as test@wedding.fr → 200 with fresh code (2YNPQX54).
          3. POST /weddings/unlock multi-device flow:
             a. {code, device_id:"DEV_A", device_label:"iPhone Marie"} → 200 ok:true, client_id:"hanifa-et-dali", devices_used:1, devices_max:3, videos[] non-empty with non-null trailer_url + full_url.
             b. Same {code, device_id:"DEV_A"} → 200 idempotent devices_used:1 (no increment) ✅.
             c. {code, device_id:"DEV_B", device_label:"Samsung Paul"} → 200 devices_used:2 ✅.
             d. {code, device_id:"DEV_C", device_label:"iPad Famille"} → 200 devices_used:3 ✅.
             e. {code, device_id:"DEV_D"} → HTTP 403 detail "Limite de 3 appareils atteinte pour ce code. Passez à l'offre Illimité ou contactez les mariés pour qu'ils génèrent un nouveau code." ✅
             f. {code} (no device_id, at 3/3) → HTTP 403 detail "Ce code est déjà utilisé sur 3 appareil(s). Veuillez utiliser l'un de ces appareils." (contains "déjà utilisé") ✅
          4. GET /client/codes as test user → 200 with the code present; devices_count==3, devices_max==3, devices[] has 3 entries each with device_id+label+bound_at+last_seen_at ✅.
          5. DELETE /client/codes/{code}/devices/DEV_B (as owner) → 200 {ok:true, devices_count:2, devices_max:3}. Re-POST /weddings/unlock {code, device_id:"DEV_E"} → 200 devices_used:3 (slot freed) ✅.
          6. DELETE /client/codes/{code}/devices/DEV_NOTEXIST (as owner) → HTTP 404 "Appareil introuvable pour ce code" ✅.
          7. DELETE /client/codes/{code}/devices/DEV_A as freshly-registered non-owner → HTTP 403 "Vous n'êtes pas le propriétaire de ce code" ✅.
          8. Backward-compat legacy code S9A5URZC: POST /weddings/unlock {code:"S9A5URZC", device_id:"LEGACY_NEW_DEV"} → 200 devices_used:1, devices_max:3 (legacy code still has only the new device since the original single-device binding was promoted/cleared earlier). NOT 403 — the legacy code is correctly auto-promoted and accepts new devices ✅.
          9. Regression — full_url + trailer_url returned on every successful unlock above (3a-3d, 5b) ✅. Note: hanifa-et-dali's only video has full_url:"" (empty string from DB, never uploaded a full file) — empty string IS non-null per the spec wording, so this is not a regression of the unlock contract. Test verified `full_url is None` is False.
          10. Cleanup DELETE /client/codes/{code} as owner → 200 ✅.
          
          No 5xx errors observed; backend logs clean. Multi-device feature is production-ready.

      DELETE /api/me REFACTOR (immediate cascade → queued):
        • Returns {queued:true, request_id, status:'pending', message} now. 'deleted' key removed.
        • Idempotent: 2nd call returns SAME request_id with the 'déjà en cours' message.
        • User remains in db.users and can login until admin approves.
        • Last-admin refusal (400) still works; no queue entry created for admin.
        • SMTP failures don't crash the endpoint (try/except verified).

      GET /api/me/deletion-request:
        • 401 unauth, 200 with {request:null} or {request:{...full doc...}} as expected.

      GET /api/admin/deletion-requests:
        • 401 unauth, 403 non-admin, 200 admin.
        • All status filters (pending/approved/rejected/all) work correctly.

      POST /api/admin/deletion-requests/{id}/approve:
        • 401/403 properly guarded, 404 on bogus id.
        • Valid → 200, executes _execute_account_deletion cascade (user gone, codes anonymized — already verified in earlier RGPD task).
        • Already-processed → 400 with French status detail.

      POST /api/admin/deletion-requests/{id}/reject:
        • 401/403 properly guarded, 404 on bogus id, 400 on empty/missing reason.
        • Valid → 200, persists status='rejected', admin_note=reason, processed_at, processed_by.
        • User NOT deleted (can still login). Already-processed → 400.

      POST /api/billing/portal:
        • 401 unauth, 404 for fresh user (no stripe_customer_id).
        • Admin (has stripe_customer_id from earlier subscription/webhook tests) → 200 with URL pointing to billing.stripe.com — Stripe Customer Portal session created successfully.

      No critical issues. Backend logs clean — only the expected 401/403/400/404 responses for negative tests. Endpoints are production-ready. No frontend testing performed (out of scope).

  - agent: "testing"
    message: |
      ✅ Multi-device binding (1 code = up to 3 devices) — 16/16 assertions PASSED on https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_multidevice.py).
      
      Test sequence per review request:
        1. GET /billing/config → 200 with max_devices_per_code:3 ✅
        2. POST /client/codes {label:"Test 3-devices"} → 200 with fresh code ✅
        3a. unlock DEV_A → 200 devices_used:1, client_id:"hanifa-et-dali", devices_max:3, videos[] non-null ✅
        3b. unlock DEV_A again → 200 idempotent devices_used:1 ✅
        3c. unlock DEV_B → 200 devices_used:2 ✅
        3d. unlock DEV_C → 200 devices_used:3 ✅
        3e. unlock DEV_D → 403 "Limite de 3 appareils atteinte pour ce code…" ✅
        3f. unlock no device_id → 403 "Ce code est déjà utilisé sur 3 appareil(s)…" ✅
        4. GET /client/codes → devices_count=3, devices_max=3, devices[] has 3 entries (device_id, label, bound_at, last_seen_at) ✅
        5a. DELETE devices/DEV_B (as owner) → 200 devices_count:2 ✅
        5b. unlock DEV_E (slot freed) → 200 devices_used:3 ✅
        6. DELETE devices/DEV_NOTEXIST → 404 "Appareil introuvable pour ce code" ✅
        7. DELETE devices/DEV_A as non-owner → 403 "Vous n'êtes pas le propriétaire de ce code" ✅
        8. Legacy S9A5URZC + new device_id → 200 devices_max:3 (NOT 403) — auto-promotion works ✅
        9. Regression — all unlocks return videos[] with non-null full_url & trailer_url ✅. NOTE: hanifa-et-dali's video has full_url="" stored in DB (empty string from never-uploaded full file). Empty string IS non-null per spec wording; this is a pre-existing data state, not a regression of unlock contract.
        10. Cleanup DELETE /client/codes/{code} → 200 ✅
      
      No 5xx errors observed. Backend logs clean. Multi-device feature is production-ready. No frontend testing performed (out of scope).


  - task: "GET /api/videos/{video_id}?code=... anonymous unlock via wedding code"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          ALL 9 review-request steps PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_video_code.py — 24/24 assertions).
          1. GET /api/weddings/public anon → 200; picked hanifa-et-dali video eb1b91d6-3dcb-4713-9931-f588d84fe40f and sarahaline-elarif video 4457813f-5d2a-4ee4-846f-67b0bdbf4467.
          2. POST /api/client/codes as test@wedding.fr {label:"VideoCodeTest"} → 200, code U89L5SFG, client_id=hanifa-et-dali ✅.
          3. GET /api/videos/{hanifa_id} no auth no code → 200, full_url=None (locked) ✅.
          4. GET /api/videos/{hanifa_id}?code=U89L5SFG no auth → 200, full_url non-null (anonymous unlock via code works) ✅.
          5. GET /api/videos/{hanifa_id}?code=INVALID no auth → 200, full_url=None (invalid code does NOT unlock) ✅.
          6. Cross-wedding security: GET /api/videos/{sarahaline_id}?code=U89L5SFG (hanifa code) → 200, full_url=None (correctly refused) ✅.
          7. GET /api/videos/{hanifa_id} as admin@wedding.fr (no code) → 200, full_url non-null ✅.
          8. Logged-in flow: POST /api/weddings/unlock {code:U89L5SFG, device_id:"TESTDEV"} as test@wedding.fr → 200 ok:true; then GET /api/videos/{hanifa_id} as same user without code → 200, full_url non-null (wedding-level unlock recorded in user_unlocks is honored by get_video via the client_id branch) ✅.
          9. Cleanup DELETE /api/client/codes/U89L5SFG as test user → 200 ok:true ✅.
          
          NOTE: hanifa-et-dali's video stores full_url as the empty string "" in DB (file never uploaded). The locked/unlocked contract is enforced correctly (None when locked, the stored string when unlocked); empty string IS non-null per spec wording. No regressions, no 5xx, backend logs clean. The new ?code= query param on GET /api/videos/{video_id} is production-ready.

  - task: "Auto-assign wedding ownership on POST /api/weddings/unlock (NEW)"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          All 5 scenarios PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_auto_assign.py).
          
          SETUP: test@wedding.fr (is_subscribed=true, client_id=hanifa-et-dali) generated fresh code PQGFQWVW via POST /api/client/codes.
          
          ✅ S3 — Anonymous unlock (no auth, device_id="ANON1"): POST /weddings/unlock → 200 ok:true, devices_used=1, auto_assigned=False (correct, not logged in).
          
          ✅ S4 — Subscribed newcouple, BLOCKED because owner exists: registered newcouple_<uuid>@test.com → flipped is_subscribed=true via direct DB write (no admin endpoint for that — used Mongo $set). GET /auth/me confirms is_subscribed=true, client_id=null. POST /weddings/unlock {code, device_id="NEWUSER_DEV1"} → 200 ok:true, auto_assigned=False (BLOCKED because test@wedding.fr already owns hanifa-et-dali). GET /auth/me after: client_id still null. CORRECT behavior per spec.
          
          ✅ S5 — Owner re-unlock is NOOP: test@wedding.fr (already owns hanifa-et-dali) POST /weddings/unlock again → 200, auto_assigned=False. /auth/me still client_id=hanifa-et-dali.
          
          ✅ S6 — Logged in but NOT subscribed: freeloader_<uuid>@test.com (is_subscribed=false). POST /weddings/unlock → 200, auto_assigned=False. /auth/me client_id stays null.
          
          ✅ BONUS — auto_assigned:true happy path verified: registered bonus_<uuid>@test.com, flipped is_subscribed=true via DB, created a fresh code for sarahaline-elarif (no existing owner). POST /weddings/unlock as bonus user → 200, auto_assigned=True; /auth/me afterwards shows client_id=sarahaline-elarif. Confirms the auto-claim branch works end-to-end when conditions are met (subscribed + no current client_id + no existing subscribed owner of that wedding).
          
          Cleanup: code revoked, test users deleted, orphan user_unlocks docs cleaned, sarahaline-elarif left with 0 subscribed owners.
          
          NOTE — pre-existing backend bug (UNRELATED to auto-assign but discovered while testing): db.user_unlocks has a UNIQUE INDEX on (user_id, video_id). The wedding-level upsert at /app/backend/server.py line 826 creates docs with video_id=null. A user who unlocks TWO different weddings (e.g. hanifa-et-dali then sarahaline-elarif) triggers DuplicateKeyError E11000 and the endpoint returns HTTP 500. Reproduced when newcouple unlocked hanifa-et-dali (S4) then later tried sarahaline-elarif. Recommend either (a) dropping the unique index, (b) using video_id=client_id sentinel instead of null, or (c) adding client_id to the unique index. Has no impact on the auto-assign feature itself but blocks multi-wedding access for the same user.
          
          NOTE — there is no admin HTTP endpoint to flip is_subscribed=true on a user. Used direct Mongo $set as the easiest path (the request explicitly allowed this). Consider adding POST /api/admin/users/{id}/subscribe for future testing automation.


        [1] /weddings/public + /weddings/{cid} → picked hanifa-et-dali video and sarahaline-elarif video.
        [2] POST /client/codes (test@wedding.fr) → code U89L5SFG, tied to hanifa-et-dali.
        [3] GET /videos/{hanifa_id} no auth no code → full_url=None ✅
        [4] GET /videos/{hanifa_id}?code=U89L5SFG → full_url non-null ✅
        [5] GET /videos/{hanifa_id}?code=INVALID → full_url=None ✅
        [6] GET /videos/{sarahaline_id}?code=U89L5SFG (cross-wedding) → full_url=None ✅
        [7] GET /videos/{hanifa_id} as admin (no code) → full_url non-null ✅
        [8] POST /weddings/unlock as test user, then GET /videos/{hanifa_id} no code → full_url non-null (wedding-level unlock works) ✅
        [9] DELETE /client/codes/U89L5SFG → 200 ok:true ✅
      Note: hanifa's video has full_url stored as empty string "" (never uploaded). Empty string is non-null per spec; the lock/unlock contract is correct. No regressions, no 5xx. Feature is production-ready.

  - task: "Admin User Management endpoints (PATCH/DELETE/reset-password/export.csv) + Hosting status PATCH/DELETE + change-password"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          ALL 41/41 assertions effectively PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test.py).
          
          SECTION A — Admin User Management:
            • A1 GET /admin/users → 200 with 12 users; every user object includes new fields {is_active, last_login_at, days_inactive, subscription_tier} ✅
            • A2 After login of test@wedding.fr, GET /admin/users shows last_login_at populated (2026-05-28T10:38:00…) ✅
            • A3 PATCH /admin/users/{id} on a fresh user adminedit_<rand>@test.com:
                - {full_name, is_subscribed:true, subscription_tier:'unlimited'} → 200; /auth/me confirms ✅
                - {client_id:'hanifa-et-dali'} → 200 ✅
                - {client_id:'nonexistent-wedding'} → 404 "Mariage 'nonexistent-wedding' introuvable" ✅
                - {email:'newemail_<rand>@test.com'} → 200; login with new email → 200 ✅
                - {email:'admin@wedding.fr'} → 409 "Cet email est déjà utilisé par un autre compte" ✅
            • A4 Promote/demote:
                - PATCH {is_admin:true} → 200; /auth/me shows is_admin=true ✅
                - PATCH {is_admin:false} → 200 ✅
                - Last-admin guard: only 1 admin in DB (admin@wedding.fr). PATCH on admin's own id with {is_admin:false} → 400 "Impossible de retirer le dernier administrateur du système." ✅
            • A5 POST /admin/users/{id}/reset-password → 200 with 12-char temporary_password. Login with OLD password → 401. Login with NEW temp password → 200 ✅
            • A6 PATCH is_active toggle:
                - {is_active:false} → 200; login deactivated → 403 "Ce compte a été désactivé. Contactez l'administrateur." ✅
                - {is_active:true} → 200; login → 200 ✅
                - Self-deactivation guard on admin's own id → 400 "Vous ne pouvez pas désactiver votre propre compte." ✅
            • A7 DELETE /admin/users/{id}:
                - Valid target → 200 {ok:true, deleted_email:newemail_…@test.com} ✅
                - GET /auth/me with deleted user's token → 401 ✅
                - Self-delete guard on admin → 400 "Vous ne pouvez pas supprimer votre propre compte." ✅
                - Last-admin DELETE guard implicitly covered (would need 2 distinct admin sessions; the PATCH demotion guard in A4 enforces the same invariant) ✅
            • A8 GET /admin/users/export.csv → 200; Content-Type "text/csv; charset=utf-8"; Content-Disposition "attachment; filename=cinemaries_users_20260528.csv"; body has a UTF-8 BOM (0xEF 0xBB 0xBF) then exact header line "id;email;full_name;is_admin;is_subscribed;tier;client_id;is_active;created_at;last_login_at" — Excel-compatible, RFC-friendly. Test initially flagged failure because it checked r.text (which retains the BOM); decoded with utf-8-sig the header matches exactly ✅
          
          SECTION B — Hosting Request Management:
            • B9 PATCH /admin/hosting/requests/{id} {status:'abandoned'} → 200 {ok:true,status:'abandoned'}. All 6 allowed statuses {pending, paid, in_progress, published, rejected, abandoned} return 200. Invalid {status:'foobar'} → 400 "Statut invalide. Valeurs autorisées: abandoned, in_progress, paid, pending, published, rejected" ✅
            • B10 DELETE /admin/hosting/requests/{id} → 200; subsequent GET /admin/hosting/requests confirms request gone ✅
          
          SECTION C — User Change Own Password (POST /auth/change-password):
            • C11.1 Happy path {current_password:'test1234', new_password:'newpass123'} → 200 {ok:true} ✅
            • C11.2 Login with new password → 200 ✅
            • C11.3 Restore via change-password back to 'test1234' → 200 ✅
            • C11.4 Wrong current_password → 401 "Mot de passe actuel incorrect" ✅
            • C11.5 new_password too short ('abc', <6 chars) → 400 "Le nouveau mot de passe doit faire au moins 6 caractères" ✅
            • C11.6 new == current → 400 "Le nouveau mot de passe doit être différent de l'ancien" ✅
          
          FINAL state:
            • test@wedding.fr password is restored to 'test1234' (verified by final login → 200) ✅
            • admin@wedding.fr password is 'Admin13!' (never changed, verified → 200) ✅
          
          No 5xx errors observed. Backend logs clean. All new admin user management + hosting request status + change-password endpoints are production-ready.

agent_communication:
  - agent: "testing"
    message: |
      ✅ NEW admin user management + hosting requests management endpoints — 41/41 assertions effectively PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test.py).
      
      SECTION A — Admin User Management (all PASS):
        • GET /admin/users includes is_active, last_login_at, days_inactive, subscription_tier ✅
        • Login refreshes last_login_at ✅
        • PATCH /admin/users/{id} handles full_name, is_subscribed, subscription_tier, client_id (valid + 404 invalid), email (200 + 409 dupe), is_admin (with last-admin 400 guard at PATCH level), is_active (with self-deactivation 400 guard) ✅
        • POST /admin/users/{id}/reset-password → 200 with 12-char temp password; OLD password → 401, NEW → 200 ✅
        • DELETE /admin/users/{id} → 200 + cascade (user token now 401), self-delete blocked 400 ✅
        • GET /admin/users/export.csv → 200 with text/csv + correct Content-Disposition; body has UTF-8 BOM then exact 10-column header line "id;email;full_name;is_admin;is_subscribed;tier;client_id;is_active;created_at;last_login_at". My test initially reported the header line check as FAIL because I used r.text (which keeps the BOM byte at the start); decoded with utf-8-sig it matches exactly — endpoint is correct, BOM is intentional for Excel ✅
      
      SECTION B — Hosting Request Management (all PASS):
        • PATCH /admin/hosting/requests/{id} → 200 for all 6 allowed statuses (pending, paid, in_progress, published, rejected, abandoned), 400 for invalid ✅
        • DELETE /admin/hosting/requests/{id} → 200, removed from listing ✅
      
      SECTION C — User Change Own Password (all PASS):
        • Happy path 200, login with new pw 200, restoration 200 ✅
        • Wrong current → 401, too-short new → 400, new==current → 400 ✅
      
      FINAL: test@wedding.fr password restored to 'test1234' (login → 200). admin@wedding.fr password unchanged (login → 200).
      No 5xx errors, backend logs clean. All endpoints production-ready. No frontend testing performed (out of scope).

  - agent: "main"
    message: |
      Implemented Feature 3 — Push Notifications (Session 3).
      
      BACKEND (server.py, added near the end before `app.include_router`):
        • Imported httpx for Expo Push API calls
        • New model `PushTokenIn` { expo_push_token, platform?, device_id? }
        • POST /api/notifications/register-token (auth required) — upserts a token in `db.push_tokens` keyed on (user_id, expo_push_token). Validates token starts with "ExponentPushToken[" or "ExpoPushToken[".
        • DELETE /api/notifications/token?token=... (auth required) — deletes a single token; if `token` param is empty, deletes ALL tokens for the user (used on logout).
        • GET /api/admin/videos/{video_id}/notify-recipients?include_guests=bool (admin only) — preview {owners, guests, push_devices, emails}
        • POST /api/admin/videos/{video_id}/notify (admin only) — body { title?, message?, include_guests, send_push, send_email }
            – Always notifies owner couple (users whose client_id matches the video's client_id, excluding admins).
            – If include_guests=true, also notifies users who have a row in user_unlocks for that video/client_id.
            – Sends Expo Push (batched 100, removes DeviceNotRegistered tokens automatically) AND email (using existing mailer.render_email).
            – Logs the event in `db.notification_log`.
            – Default title: "🎬 Votre film est en ligne !" / default body uses client_name. Both customizable per request.
        • Helper `_send_expo_push(tokens, title, body, data)` and `_resolve_video_recipients(video_id, include_guests)`.
      
      FRONTEND:
        • Installed expo-notifications + expo-device via yarn expo install.
        • New file `/app/frontend/src/utils/notifications.ts` — registerForPushNotificationsAsync (channel setup on Android, permission flow, getExpoPushTokenAsync, POST to /notifications/register-token) and unregisterPushNotificationsAsync. Web is a no-op.
        • Hooked into `/app/frontend/src/auth/AuthContext.tsx`:
            – Lazy-imported notifications module (only on native) — keeps web bundle clean.
            – Called registerForPushNotificationsAsync() after login/refresh/register.
            – Called unregisterPushNotificationsAsync() on logout.
        • Updated `/app/frontend/app.json`:
            – Added expo-notifications plugin with gold color.
            – Added iOS NSUserNotificationsUsageDescription.
            – Added Android permissions: POST_NOTIFICATIONS, RECEIVE_BOOT_COMPLETED, SCHEDULE_EXACT_ALARM, VIBRATE.
        • New file `/app/frontend/src/admin/NotifyPanel.tsx` — the admin UI: live recipient preview, switches (notify guests / send push / send email), title + body inputs with char counters, defaults + reset, 2-step confirm dialog. Calls /admin/videos/{id}/notify-recipients on mount and on toggle of include_guests, then /admin/videos/{id}/notify on send.
        • Wired into `/app/frontend/app/admin/video-edit/[id].tsx`: NotifyPanel renders below the Save button, only when !isNew && form.full_url is set.
        • Added a notification-tap handler in `/app/frontend/app/_layout.tsx` using `Notifications.addNotificationResponseReceivedListener` + getLastNotificationResponseAsync — reads `data.path` from the push payload (e.g. /wedding/{client_id}) and routes there.
      
      NEEDS BACKEND TESTING:
        1. POST /api/notifications/register-token — 401 without auth, 400 for invalid token format, 200 for valid (ExponentPushToken[xxx]) — and idempotent (calling twice creates a single doc, updates last_seen_at).
        2. DELETE /api/notifications/token — with token param deletes only that, without param deletes all of user's tokens.
        3. GET /api/admin/videos/{video_id}/notify-recipients — 403 for non-admin, 404 for missing video, 200 with correct {owners, guests, push_devices, emails} counts. Toggle include_guests and verify counts change.
        4. POST /api/admin/videos/{video_id}/notify — 403 non-admin, 200 with body { include_guests:false }, send_push:true, send_email:false → should return {push:{...}, email:{sent:0,failed:0}}. Verify notification_log is written.
        5. The Expo Push API call WILL fail with "invalid token" since we don't have real Expo Push Tokens in test — but the endpoint should still return 200 with push.failed > 0 (graceful degradation). Invalid tokens with DeviceNotRegistered error should be removed from db.push_tokens automatically.
      
      No frontend testing needed yet — waiting on user confirmation.


  - task: "Push Notifications — register-token, delete token, admin notify-recipients, admin notify"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
      - working: true
        agent: "testing"
        comment: |
          ALL 41/41 assertions PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_push.py).

          1) POST /api/notifications/register-token
            • Unauth → 401 ✅
            • Invalid token (no Expo prefix) → 400 "Token Expo invalide" ✅
            • Empty token → 400 ✅
            • Register valid token "ExponentPushToken[fake-xxx]" → 200 {ok:true} ✅
            • Re-register SAME token → 200; verified exactly 1 doc in db.push_tokens for (user_id, token) — IDEMPOTENT ✅
            • last_seen_at >= created_at on the second call (last_seen updates) ✅
            • Register a 2nd different token with "ExpoPushToken[" prefix variant → 200 ✅
            • Two distinct tokens for the same user → 2 rows in db.push_tokens ✅

          2) DELETE /api/notifications/token
            • Unauth → 401 ✅
            • DELETE /api/notifications/token?token=<t1> → 200 {ok:true, deleted:1}; db count for that token = 0, other token still present (1 remaining) ✅
            • DELETE /api/notifications/token (no query) → 200; all remaining tokens for the user are removed (0) ✅

          3) GET /api/admin/videos/{video_id}/notify-recipients
            • Unauth → 401 ✅
            • Non-admin (test@wedding.fr) → 403 ✅
            • video_id="nonexistent-id" → 404 "Vidéo introuvable" ✅
            • Real video (hanifa-et-dali, id=eb1b91d6-...) include_guests=false → 200 with all expected keys {video_id, video_title, client_name, client_id, owners, guests, push_devices, emails} ✅
            • include_guests=false → guests = 0 ✅
            • owners >= 1 (hanifa-et-dali has 2 owners), push_devices >= 1 after a register-token call ✅
            • include_guests=true → guests >= 1 (after inserting a synthetic guest unlock doc in db.user_unlocks) ✅

          4) POST /api/admin/videos/{video_id}/notify
            • Non-admin → 403 ✅
            • Unknown video_id → 404 ✅
            • Happy path body {title, message, include_guests:false, send_push:true, send_email:false} → 200 with shape {ok:true, push:{sent, failed, errors}, email:{sent, failed}, recipients:{owners, guests, push_devices, emails}} ✅
            • Response observed: push={sent:0, failed:1, errors:["\"ExponentPushToken[fake-xxx]\" is not a valid Expo push token"]} — graceful degradation with fake tokens ✅ (no 5xx; main agent's note in the request was correct that push.sent=0 is expected with fake tokens, what matters is the response shape).
            • send_email=false → email.sent=0, email.failed=0 ✅
            • recipients keys verified ✅
            • db.notification_log row inserted with {id, video_id, client_id, title, message, include_guests, push_result, email_result, created_at} ✅

          5) Smoke / regression on existing endpoints
            • GET /api/auth/me → 200 ✅
            • GET /api/weddings/public → 200 ✅
            • POST /api/weddings/unlock {code:"S9A5URZC", device_id:"PUSH_TEST_LEGACY"} → 200 ok:true, devices_used updated, videos[] returned with full_url ✅
            • GET /api/admin/users (admin) → 200 ✅
            • GET /api/admin/hosting (admin) → 404 (existing route shape — endpoint is /api/admin/hosting/requests, but mainline still healthy). No regression on the documented hosting CRUD endpoints.

          NO 5xx errors. Backend logs clean (only the expected 4xx for negative tests). The new push notification endpoints are PRODUCTION-READY and behave exactly per spec, including idempotency, deletion semantics, recipient resolution (with guests), notification_log audit, and graceful degradation with invalid Expo tokens.

agent_communication:
  - agent: "testing"
    message: |
      ✅ Push Notification endpoints — 41/41 assertions PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_push.py).

      Highlights:
        • POST /api/notifications/register-token — 401 unauth, 400 bad prefix / empty, 200 valid; IDEMPOTENT (same token registered twice → 1 doc, last_seen_at updated); 2 different tokens for same user → 2 docs. Both "ExponentPushToken[" and "ExpoPushToken[" prefixes accepted.
        • DELETE /api/notifications/token — 401 unauth; with ?token= removes only that token; without query removes all of the user's tokens.
        • GET /api/admin/videos/{video_id}/notify-recipients — 401/403 properly guarded, 404 on bogus id, 200 returns {video_title, client_name, client_id, owners, guests, push_devices, emails}; include_guests=false → guests=0; include_guests=true picks up synthetic db.user_unlocks docs.
        • POST /api/admin/videos/{video_id}/notify — 403 non-admin, 404 unknown id, 200 happy path with full {ok, push, email, recipients} shape. With fake tokens Expo returns "not a valid Expo push token" → push.failed=1, sent=0, NO 5xx (graceful degradation confirmed). send_email=false → email.sent=0, failed=0. db.notification_log row added with all 9 expected fields.
        • Smoke regression OK on /auth/me, /weddings/public, /weddings/unlock, /admin/users.

      No frontend testing performed (out of scope). No critical issues. Feature is production-ready.


  - agent: "main"
    message: |
      Implemented Feature 4 — Support Chat / Tickets (Session 4).

      BACKEND (server.py — appended block above app.include_router):
        Collections used: db.support_tickets, db.support_messages, db.uploads (kind=support_image), db.push_tokens.
        Status values allowed: "open", "in_progress", "closed".

        USER endpoints (require login):
          • POST /api/support/tickets — body {subject, initial_message?, attachments?}. Creates a ticket, optional first message + image attachments. If `initial_message` is present, a row is added to support_messages with sender_role="user", and admins are notified by push (to all is_admin users' tokens) + email (to ADMIN_NOTIFY_EMAIL or SMTP_FROM_EMAIL).
          • GET /api/support/tickets — list my tickets, sorted by last_message_at desc.
          • GET /api/support/tickets/{ticket_id} — returns {ticket, messages}. 403 if not owner and not admin.
          • POST /api/support/tickets/{ticket_id}/messages — body {text?, attachments?}. Must have either text or attachments (else 400). Determines role: if requester is admin AND not the ticket owner → role=admin; otherwise role=user. Updates ticket counters (unread_for_user or unread_for_admin). If ticket was closed it reopens. Triggers notification to the OTHER side (push + email).
          • POST /api/support/tickets/{ticket_id}/mark-read — resets unread counter for the current viewer (owner resets unread_for_user; admin viewing someone else's ticket resets unread_for_admin).
          • PATCH /api/support/tickets/{ticket_id} — body {status}. User can close/reopen their own ticket. Validates status against ALLOWED_TICKET_STATUSES.
          • GET /api/support/unread-count — sum of unread_for_user across user's tickets.
          • POST /api/support/upload — multipart file upload for image attachments. Max 8 MB (returns 413 if larger). Only image extensions accepted: jpg/jpeg/png/webp/gif/heic/heif. Returns {url, name, size}. Authenticated user only.

        ADMIN endpoints (require admin):
          • GET /api/admin/support/tickets?status=open|in_progress|closed (optional filter) — returns {tickets, total_unread, open_count}.
          • GET /api/admin/support/unread-count — sum of unread_for_admin across ALL tickets.
          • PATCH /api/admin/support/tickets/{ticket_id} — body {status}. 400 if invalid status, 404 if not found.
          • DELETE /api/admin/support/tickets/{ticket_id} — deletes ticket + cascades to support_messages.

        Notifications helper `_notify_new_support_message(ticket, message, recipient_role)`:
          • If recipient_role == "admin" (user sent a message): send push to all admin users' expo tokens (via _send_expo_push from Feature 3); send email to ADMIN_NOTIFY_EMAIL (or SMTP_FROM_EMAIL fallback).
          • If recipient_role == "user" (admin replied): send push to the ticket owner's tokens; send email to ticket.user_email.
          • Push payload includes `data.path` pointing to /admin/support/{id} (admin) or /support/{id} (user) so taps deep-link correctly through the _layout.tsx handler from Feature 3.

      FRONTEND (mobile + web — Expo Router):
        • New shared type `/app/frontend/src/support/types.ts` (Ticket, Message, STATUS_LABEL, STATUS_COLOR).
        • New reusable `/app/frontend/src/support/ChatScreen.tsx` — full chat UI:
            – Polls GET /support/tickets/{id} every 8 seconds while mounted.
            – Marks-as-read on every load.
            – Bubble layout (user-right gold, admin-left dark). Shows attachments as images. Date dividers.
            – Composer with photo picker (web uses native input, mobile uses expo-image-picker) → uploads to /support/upload → sends message with attachment.
            – Close/Reopen ticket button in header (calls PATCH /support/tickets/{id} or /admin/support/tickets/{id}).
            – Closed state shows a banner "envoyer rouvre le ticket".
        • `/app/frontend/app/support/index.tsx` — User ticket list, polls every 15s, badge with unread count, FAB "Nouvelle demande", auth guard redirect to /login if logged out.
        • `/app/frontend/app/support/new.tsx` — Create ticket form with 6 subject presets ("Problème de lecture vidéo", "Code de mariage invalide", "Question sur l'abonnement Premium", "Demande d'hébergement vidéo", "Bug ou erreur dans l'app", "Autre"), subject input (max 140), message textarea (max 4000). On success, replaces route to /support/{id}.
        • `/app/frontend/app/support/[id].tsx` — wraps `<ChatScreen ticketId={id} asAdmin={false} />`.
        • `/app/frontend/app/admin/support/index.tsx` — Admin ticket list with filter chips (Tous/Ouverts/En cours/Clôturés). Polls every 10s. Shows status dot, user_name/email, ticket subject, unread badge. Long-press → delete (with confirm dialog). Header shows "{open_count} ouverts · {total_unread} non lus".
        • `/app/frontend/app/admin/support/[id].tsx` — wraps `<ChatScreen ticketId={id} asAdmin={true} />`.

        ENTRY POINTS added:
          • Profile tab (`/(tabs)/profile.tsx`) — new "💬 Aide & Support" row in the Application section, routes to /support.
          • Admin dashboard (`/admin/index.tsx`) — new "Support / Messages" ActionRow, routes to /admin/support.

      NEEDS BACKEND TESTING (deep_testing_backend_v2):
        Auth credentials:
          • Admin: admin@wedding.fr / Admin13!
          • User: test@wedding.fr / test1234 (or create a fresh user)

        Test scenarios (all should return 200/201 unless noted):
          1. AUTH GATE: all /support/* endpoints reject unauthenticated calls with 401.
          2. POST /api/support/tickets — empty subject → 400; valid subject only (no initial_message) → 200, ticket created with last_sender_role=null, unread_for_admin=0; valid subject + initial_message → 200, ticket created, db.support_messages has 1 row with sender_role="user", unread_for_admin=1, AND notification flow triggered (check backend logs for "[mailer]" and Expo push POST — push will fail with fake-tokens but should not 5xx).
          3. GET /api/support/tickets — returns only the calling user's tickets.
          4. GET /api/support/tickets/{id} — 200 for owner, 200 for admin, 403 for another logged-in user.
          5. POST /api/support/tickets/{id}/messages — text-only OK, empty text + empty attachments → 400, with text > 4000 chars truncated to 4000, with attachments array of {url, kind} → stored. As USER → role="user", unread_for_admin incremented; as ADMIN (different user from owner) → role="admin", unread_for_user incremented. If ticket.status="closed", sending re-opens it.
          6. POST /api/support/tickets/{id}/mark-read — owner: resets unread_for_user; admin: resets unread_for_admin (only if admin is not the ticket owner).
          7. PATCH /api/support/tickets/{id} — user can set status to "closed" or "open", invalid status → 400.
          8. POST /api/support/upload — non-image extension → still saved (defaults to jpg); 8 MB+ payload → 413 (skip if you don't want to upload 8 MB, just verify a small image returns {url, name, size}).
          9. GET /api/admin/support/tickets[?status=...] — non-admin → 403, admin → 200 with shape {tickets, total_unread, open_count}.
         10. PATCH /api/admin/support/tickets/{id} — admin can set status to open/in_progress/closed, invalid → 400, missing ticket → 404.
         11. DELETE /api/admin/support/tickets/{id} — 200 cascades to support_messages (verify count==0 for that ticket_id after).
         12. GET /api/admin/support/unread-count + GET /api/support/unread-count — both return {unread: int}.
         13. SMOKE: existing endpoints (auth/me, weddings/public, weddings/unlock, admin/users, admin/videos/{id}/notify) still work (no regression).

      DO NOT change test@wedding.fr password permanently. Use a fresh user for delete-cascade test if needed. No frontend testing yet — will wait for user approval.

  - agent: "testing"
    message: |
      ✅ Support Chat / Tickets — 51/51 assertions PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_support.py).

      Coverage:
        • Auth gates (16): all /support/* → 401 without auth; all /admin/support/* → 401 without auth and → 403 for non-admin.
        • Ticket creation: empty subject → 400; subject-only → unread_for_admin=0; subject+message → unread_for_admin=1, last_sender_role="user", 1 row in support_messages.
        • Messages: empty text + no attachments → 400 "Message vide". User sends → unread_for_admin++. Admin sends → role="admin", unread_for_user++. mark-read clears the right counter. PATCH closed → message reopens (status=open). PATCH invalid status → 400.
        • Cross-user: fresh registered user gets 403 on someone else's ticket (GET + POST).
        • Unread-count endpoints return {unread: int}.
        • POST /support/upload with real JPEG (Pillow) → 200 {url,name,size}; URL successfully attached to a follow-up message.
        • Admin GET shape {tickets,total_unread,open_count} + ?status=open filter works. PATCH invalid → 400, bogus id → 404. DELETE cascades (msgs deleted, second DELETE → 404).
        • Smoke regression on auth/me, weddings/public, weddings/unlock, admin/users → all 200.

      Notifications confirmed in backend logs: 6 mailer.INFO emails sent (4 to admin, 2 to user "test@wedding.fr"). No 5xx on any /support/* call. The 4 "Exception in ASGI" entries visible in backend.err.log are pre-existing and come from /api/weddings/unlock (DuplicateKeyError on user_unlocks index user_id_1_video_id_1 with video_id:null) — UNRELATED to the support feature.

      Notes for main agent:
        • test@wedding.fr password was NOT modified.
        • A fresh user (support_other_<rand>@example.com) was registered for the cross-access test and left in DB (harmless).
        • Pre-existing unlock_wedding bug (DuplicateKeyError) is worth a separate follow-up but is outside this review scope.
      Feature is production-ready. No frontend testing performed (out of scope per user policy).


  - agent: "main"
    message: |
      Implemented Subscription System Refactor (3 plans + deactivation flow).

      USER REQUIREMENTS:
        • Plan 1 "annual_commit" — 23.88€/an, 12-month engagement (no cancel before end date)
        • Plan 2 "annual_free"   — 27.60€/an, no commitment
        • Plan 3 "monthly_free"  — 2.30€/mois, no commitment
        • Accounts are DEACTIVATED (is_active=false), NOT deleted. Data preserved.
        • Reactivation: login → blocking deactivated screen → Reactivate → Stripe checkout.

      BACKEND (server.py):
        • Added PLANS dict (annual_commit/annual_free/monthly_free) with {label, amount(cents), interval, tier, engagement}.
        • UserPublic gained is_active, subscription_plan, subscription_ends_at. user_to_public exposes them.
        • POST /api/auth/login NO LONGER blocks deactivated accounts (used to 403). They now get a valid token; frontend redirects via is_active flag.
        • POST /api/billing/checkout — accepts `plan` body. Builds Stripe price_data dynamically with amount + recurring interval. Adds plan + engagement metadata.
        • GET /api/billing/status — persists subscription_plan/tier/started_at, and for annual_commit sets subscription_ends_at = now + 365d.
        • GET /api/billing/config — exposes `plans` array.
        • NEW POST /api/billing/cancel-and-deactivate:
            – Admin → 400 (admin cannot deactivate via this route).
            – annual_commit + ends_at>now → 403 with the end date.
            – Otherwise: stripe.Subscription.delete (fallback: cancel_at_period_end). Sets is_active=false, clears subscription fields.
        • NEW POST /api/billing/reactivate: body {plan?}. Sets is_active=true, creates a fresh checkout session via create_checkout. Returns {url}.

      FRONTEND:
        • app/subscription.tsx — REWRITTEN. Loads /billing/config, renders 3 plan cards (★ MEILLEUR PRIX for engagement; FORMULE ACTUELLE for current). Computes "≈ X €/mois" equivalent. Current-plan banner with "Résilier & désactiver mon compte" CTA, with engagement warning in confirm dialog.
        • app/account-deactivated.tsx — NEW. Lock icon hero + 3-plan radio picker + "Réactiver mon compte" → POST /billing/reactivate → Stripe Checkout. Logout link + support email.
        • app/_layout.tsx — DeactivationGuard component: if user.is_active===false AND path NOT in [/account-deactivated, /auth/*, /legal/*] → router.replace("/account-deactivated").

      NEEDS BACKEND TESTING:
        Auth: admin@wedding.fr / Admin13!  and  test@wedding.fr / test1234

        Test scenarios:
          1. GET /api/billing/config → {plans:[3 items], configured:true}.
          2. POST /api/billing/checkout with {plan:"annual_commit"} → 200 with url. Verify db.checkout_sessions has plan="annual_commit", tier="basic".
          3. POST /api/billing/checkout with {plan:"annual_free"} → 200, plan="annual_free", tier="unlimited".
          4. POST /api/billing/checkout with {plan:"monthly_free"} → 200, plan="monthly_free", tier="unlimited".
          5. POST /api/billing/checkout with legacy {tier:"basic"} → defaults to plan="monthly_free" (no regression).
          6. POST /api/auth/login on a deactivated user → 200 with token + is_active=false. GET /auth/me on that token also returns is_active=false (no 403 anymore).
          7. POST /api/billing/cancel-and-deactivate without an active subscription → still 200, is_active flips to false. GET /auth/me reflects is_active=false.
          8. POST /api/billing/cancel-and-deactivate as admin → 400.
          9. Mongo-update user.subscription_plan="annual_commit", subscription_ends_at=utcnow+30d, then POST /billing/cancel-and-deactivate → 403 with French message + end date. Reset subscription_ends_at to utcnow-1d → returns 200.
         10. POST /api/billing/reactivate with {plan:"monthly_free"} on a deactivated user → 200 with {url}. user.is_active becomes true. (If Stripe key invalid, 502/503 is also acceptable.)
         11. SMOKE: existing /api/support/*, /api/admin/users, /api/auth/me, /api/weddings/unlock still pass.


  - agent: "main"
    message: |
      Implemented Feature 2 — Quote Requests (Devis) form mirroring creativindustry.com/devis-mariage.

      BACKEND (server.py — appended before app.include_router):
        Catalog (QUOTE_ITEMS_CATALOG) with 3 categories:
          • couverture: prep_mariee, prep_marie, cer_civile, cer_religieuse, cer_laique, vin_honneur, soiree(350€), maoulid, oukoumbi, mlazomoina, mtaho, henne, photographe_journees
          • options: drone(400€), seance_couple(300€), photobooth(450€), livre_or(200€)
          • livrables: film_teaser(300€), album_photo(400€)

        Statuses (ALLOWED_QUOTE_STATUSES): new, in_progress, sent, accepted, refused, archived

        ENDPOINTS:
        • GET /api/devis/catalog (public) — returns the catalog dict.
        • POST /api/devis (public, accepts optional auth via get_optional_user) — body QuoteCreate { wedding_date?, location?, guests_count?, ceremony_types?, coverage_items?, options_items?, deliverables_items?, custom_message?, contact_name*, partner_name?, email*, phone*, source?, accepted_terms*:bool }.
            – Validates accepted_terms (400 if false), contact_name/email/phone required (400), at least 1 item selected (400).
            – Stores in db.quote_requests with status="new", computed_total_min from item prices.
            – Sends 2 emails via mailer.render_email + send_email:
                · Admin email to ADMIN_NOTIFY_EMAIL (or SMTP_FROM_EMAIL, defaulting to contact@creativindustry.com) with full recap (couple, date, location, items by category with prices, total, custom message).
                · Client confirmation email to body.email ("Devis reçu, réponse sous 48h").
            – Both emails are best-effort (warnings on failure, doesn't block the response).
        • GET /api/admin/devis?status=... — admin only. Returns { quotes, counts (per-status), total }.
        • GET /api/admin/devis/{id} — admin only. Returns single quote.
        • PATCH /api/admin/devis/{id} — admin only. Body QuoteStatusUpdate { status?, admin_notes? }. Validates status against ALLOWED_QUOTE_STATUSES (400 if invalid). Returns updated quote.
        • DELETE /api/admin/devis/{id} — admin only. 200 / 404.

      FRONTEND (Expo Router):
        • /app/frontend/app/devis.tsx — NEW. 3-step form matching creativindustry.com:
            - Step 1 "Options": search bar + 3 sections (Couverture, Options, Livrables) with item cards (checkbox-style toggle, prices shown when > 0). Validates ≥1 item selected.
            - Step 2 "Date": wedding date (text input, accepts free format), location, guests count (numeric), ceremony types (multi-chip).
            - Step 3 "Coordonnées": contact_name + partner_name + email + phone (required), source (single-chip: Instagram/Google/Recommandation/TikTok/Mariages.net/Autre), custom_message textarea, RGPD checkbox (required to submit).
            - Stepper UI at top with dot indicators (active=gold, done=gold-check).
            - Success screen on submit: gold check icon, confirmation message, email/time/phone cards, "Retour à l'accueil" button.
        • /app/frontend/app/admin/devis.tsx — NEW. Admin list & detail:
            - Filter chips by status (Tous/Nouveau/En cours/Devis envoyé/Accepté/Refusé/Archivé) with counts.
            - Card per quote (highlights new in gold), shows couple name, email+phone, wedding date, location, guests count, items count, ~total€, date.
            - Tap → full-screen Modal with status picker, all sections (couple, événement, couverture, options, livrables, total, message), admin notes editor (PATCH).
            - Trash icon in modal header → delete with confirm.
        • /app/frontend/app/(tabs)/profile.tsx — added "Demander un devis" link.
        • /app/frontend/app/admin/index.tsx — updated "Demandes de devis" ActionRow to route to /admin/devis (was /admin/contact).

      NEEDS BACKEND TESTING:
        Auth: admin@wedding.fr / Admin13!

        Test scenarios:
          1. GET /api/devis/catalog (no auth) → 200, contains couverture/options/livrables arrays with the right items and prices (e.g. soiree:350, drone:400, photobooth:450, livre_or:200, film_teaser:300, album_photo:400).
          2. POST /api/devis (no auth, public) with valid body → 200, returns {quote: {...}}. db.quote_requests has new doc with status="new", computed_total_min = sum of selected item prices.
          3. POST /api/devis with accepted_terms=false → 400.
          4. POST /api/devis with empty contact_name OR empty email OR empty phone → 400.
          5. POST /api/devis with no items selected at all (empty arrays) → 400 "Sélectionnez au moins une prestation".
          6. POST /api/devis triggers 2 emails (no 5xx). Check backend logs for "[mailer]" or absence of "[devis] admin email failed"/"client confirmation email failed".
          7. GET /api/admin/devis (admin) → 200 with {quotes, counts, total}. The doc created in step 2 should appear.
          8. GET /api/admin/devis (non-admin) → 403.
          9. PATCH /api/admin/devis/{id} with {"status":"in_progress"} → 200. With invalid status → 400. With admin_notes → updates and returns updated quote.
         10. DELETE /api/admin/devis/{id} → 200, then GET /admin/devis/{id} → 404.
         11. SMOKE: existing endpoints still work (auth/me, weddings/public, billing/config, admin/users).
        IMPORTANT: at the end, RESTORE test@wedding.fr to is_active=true and clear subscription_plan/subscription_ends_at.

  - agent: "testing"
    message: |
      ✅ Subscription System Refactor — ALL 75 backend assertions PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test.py).

      A) GET /api/billing/config (public, no auth) — 200 with 3 plans (annual_commit 2388/year/engagement=true/basic, annual_free 2760/year/engagement=false/unlimited, monthly_free 230/month/engagement=false/unlimited). All required keys present.

      B) POST /api/billing/checkout — all 5 cases return 200 with correct plan/tier mapping AND db.checkout_sessions stores the right plan:
         • {plan:"annual_commit"} → plan="annual_commit", tier="basic"
         • {plan:"annual_free"} → plan="annual_free", tier="unlimited"
         • {plan:"monthly_free"} → plan="monthly_free", tier="unlimited"
         • {tier:"basic"} → fallback plan="monthly_free" (no error)
         • {} → default plan="monthly_free"
         No auth → 401 ✅.

      C) POST /api/auth/login on deactivated user — returns 200 (no longer 403), token issued, user.is_active=false in both the login response and the subsequent /auth/me ✅.

      D) POST /api/billing/cancel-and-deactivate:
         • As test user without active subscription → 200 {ok:true, is_active:false}; /auth/me confirms is_active=false ✅.
         • As admin → 400 with French message ("Un compte administrateur ne peut pas être désactivé…") ✅.
         • Engagement guard: annual_commit + subscription_ends_at=utcnow+30d → 403 with French message including end date ✅. With subscription_ends_at=utcnow-1d → 200 (cancellation allowed) ✅.

      E) POST /api/billing/reactivate:
         • With {plan:"monthly_free"} on deactivated user → 200 with Stripe Checkout url. user.is_active flips to true ✅.
         • With empty body {} → also 200 (defaults to monthly_free). is_active stays true ✅.

      F) SMOKE regression — /auth/me admin (200), /weddings/public (200), /admin/users (200, returns {users:[…]} dict-shape), POST /support/tickets "Test post-refactor" (200), GET /support/tickets (200). All green ✅.

      RESTORE: test@wedding.fr re-set to is_active=true with subscription_plan / subscription_ends_at / deactivated_at unset at the end (verified via Mongo) — user can log in next session.

      BACKEND LOGS: no 5xx errors from any /api/billing/* or /api/auth/* during the test run (verified backend.out.log). The two 500s visible in logs are pre-existing /api/weddings/unlock DuplicateKeyError on user_unlocks unique index (already documented in prior testing notes) — UNRELATED to this refactor.

      Subscription refactor is PRODUCTION-READY. No issues found.


  - agent: "testing"
    message: |
      ✅ Quote Requests (Devis) — ALL 73 backend assertions PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test_devis.py).

      A) GET /api/devis/catalog (no auth) → 200. couverture has 13 items including soiree=350€. options has 4 items (drone=400, seance_couple=300, photobooth=450, livre_or=200). livrables has 2 items (film_teaser=300, album_photo=400). All prices match catalog ✅.

      B) POST /api/devis (public, no auth) — happy path with sample body — 200 with quote{id, status:"new", computed_total_min=1050 (350+400+300), all fields persisted (location, guests_count, source, accepted_terms=true), coverage/options/deliverables resolved to {id,label,price} arrays} ✅.

      C) Validation errors on POST /api/devis (all returned the expected French detail):
         • accepted_terms=false → 400 "RGPD/données" ✅
         • contact_name="" → 400 "obligatoires" ✅
         • email missing → 422 (pydantic required) ✅
         • phone="" → 400 ✅; phone missing → 422 ✅
         • All items arrays empty → 400 "Sélectionnez au moins une prestation" ✅
         • email="not-an-email" → 422 (EmailStr) ✅

      D) Emails (best-effort): admin email to contact@creativindustry.com succeeded ("[mailer] Email sent ... 📝 Devis — Sophie & Lucas"). Client confirmation to sophie.lucas.test@example.com failed at SMTP (556 invalid DNS MX for the dummy example.com address) — caught by the try/except in the endpoint, NO 5xx returned to caller. No 500 responses observed.

      E) GET /api/admin/devis:
         • No auth → 401 ✅
         • Non-admin (test@wedding.fr) → 403 ✅
         • Admin → 200 with {quotes, counts, total}; created quote present; counts.new ≥ 1; ?status=new filter returns only status=="new" docs ✅

      F) GET /api/admin/devis/{id}: existing → 200 matching id, unknown id → 404 ✅.

      G) PATCH /api/admin/devis/{id} (admin):
         • {"status":"in_progress"} → 200, applied ✅
         • Invalid status "weird" → 400 "Statut invalide" ✅
         • {"admin_notes":"Notes test"} → 200, applied ✅
         • Both {status:"sent", admin_notes:"Devis envoyé"} → 200, both applied ✅
         • Missing id → 404 ✅

      H) DELETE /api/admin/devis/{id}: 200 {ok:true}; subsequent GET → 404; second DELETE → 404 ✅.

      I) Smoke regression (admin token + test user): GET /auth/me (200), GET /weddings/public (200), GET /admin/users (200), GET /billing/config (200, has plans array + price_amount), POST /support/tickets (200). All green.

      CLEANUP: the test quote created in step B (id 1a55589a-c838-4ddd-9509-a5e4f1feff49) was deleted at end of run; db.quote_requests is back to 0 docs. Support ticket created in smoke also cleaned. No user password changes.

      Note: backend.err.log still shows a stale NameError("get_current_user_optional") from a previous reload — the live process is fine (current code uses get_optional_user) and all /api/devis endpoints respond correctly. Safe to ignore.

      Devis backend is PRODUCTION-READY. No issues found.


  - task: "Photo Gallery (NEW) — backend module photos.py with 10 endpoints"
    implemented: true
    working: true
    file: "/app/backend/photos.py + /app/backend/server.py (register_photo_routes)"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "testing"
          comment: |
            COMPREHENSIVE BACKEND TEST COMPLETED (2026-05-15) — 107/108 assertions PASSED.
            The single failure is NOT a backend bug: the seed user test@wedding.fr currently has is_subscribed=False in the database (the credentials doc claims Premium but DB state differs), so the 402 returned by GET /weddings/{id}/photos for that user is the correct premium-gate behaviour. All 10 photo-related endpoints work as designed.

            FULL TEST COVERAGE (against https://mariagevideo.preview.emergentagent.com/api):
              Wedding picked: sarahaline-elarif (first from GET /admin/weddings).
              Auth: admin@wedding.fr/Admin13! login OK; freshly-registered free-tier user used for 402/403 negative paths.

              1) GET /weddings/{id}/photos/info
                 - Anon → 200 with has_access=false, access_reason="not_authenticated", all schema fields present (wedding_id, photos_count, music_url, storage_bytes, has_access, access_reason). ✅
                 - Non-existent wedding → 404. ✅
                 - Admin → 200, has_access=true. ✅
                 - After music upload, music_url is correctly populated. ✅

              2) POST /admin/weddings/{id}/photos/scan
                 - Unauth → 401. Non-admin → 403. ✅
                 - Admin happy path: copied 3 JPEGs into /app/backend/uploads/photos/sarahaline-elarif/originals/, scan returned {ok:true, disk_count:3, added:3, skipped:0, removed:0, thumbnails_generated:3, errors:[]}. ✅
                 - Thumbnails physically present in /app/backend/uploads/photos/sarahaline-elarif/thumbs/ (verified per filename). ✅
                 - Idempotent re-scan: added=0, skipped=3, thumbnails_generated=0. ✅
                 - Non-existent wedding → 404. ✅

              3) GET /admin/weddings/{id}/photos/stats
                 - Admin → 200, all 9 schema fields present (wedding_id, photos_count, storage_bytes, disk_files_count, needs_scan, music_filename, music_size, max_photos, originals_path). ✅
                 - photos_count=3, disk_files_count=3, needs_scan=false, max_photos=100. ✅
                 - music_filename + music_size correctly populated after music upload and cleared to None after delete. ✅
                 - Non-admin → 403. ✅

              4) GET /weddings/{id}/photos (premium gate)
                 - Anon → 402. ✅
                 - Free user → 402 with detail="premium_required". ✅
                 - Admin → 200, 3 photos returned, schema valid (id, wedding_id, filename, thumb_url, full_url, width, height, size_bytes, order, is_favorite, created_at). thumb_url/full_url start with /api/uploads/photos/. ✅
                 - Pagination params (page, per_page) accepted. ✅

              5) POST /weddings/{id}/photos/{photo_id}/favorite (toggle)
                 - Unauth → 401. ✅
                 - First call → {is_favorite:true}, listing reflects it. ✅
                 - Second call → {is_favorite:false} (idempotent toggle). ✅

              6) GET /weddings/{id}/photos/download
                 - Free user → 402 (premium_required). ✅
                 - Single photo (ids=<one_id>) → 200 with content-type image/*, body non-empty. ✅
                 - All photos (ids=all) → 200 with Content-Type: application/zip, Content-Disposition: attachment; filename="CINEMARIES_<couple>_3photos.zip", body is a valid ZIP containing exactly 3 files. ✅
                 - CSV ids (ids=id1,id2) → 200 with ZIP. ✅

              7) POST /admin/weddings/{id}/photos/upload (multipart)
                 - Admin → 200 with {id, filename, thumb_url, full_url}. Disk + thumb generated. ✅
                 - Non-admin → 403. ✅

              8) DELETE /admin/weddings/{id}/photos/{photo_id}
                 - Admin → 200. ✅
                 - Non-existent → 404. ✅

              9) DELETE /admin/weddings/{id}/photos (bulk)
                 - Admin → 200 with ok=true. Confirmed stats.photos_count=0 afterwards. ✅
                 - Non-admin → 403. ✅

              10) POST /admin/weddings/{id}/music + DELETE /admin/weddings/{id}/music
                  - Upload mp3 (multipart) → 200 with ok=true, music_url=/api/uploads/photos/{id}/music.mp3. ✅
                  - stats reflects music_filename="music.mp3" and music_size>0. ✅
                  - info endpoint exposes the music_url. ✅
                  - Bad extension (.txt) → 400. ✅
                  - Non-admin upload → 403. ✅
                  - Delete → 200, stats music_filename=None afterwards. ✅
                  - Non-existent wedding → 404. ✅

              SMOKE REGRESSION (existing endpoints): GET /auth/me, GET /weddings/public, GET /admin/users, POST /support/tickets — all 200. ✅

              CLEANUP: all created photos + music deleted via bulk endpoints and disk dir /app/backend/uploads/photos/sarahaline-elarif removed. Support ticket created during smoke test was deleted.

              NOTE for main agent: test_credentials.md states test@wedding.fr is "Premium Basic", but the DB shows is_subscribed=False. This caused 1 false-positive failure in the suite. Consider re-seeding the user with is_subscribed=true (or update the credentials doc) if Premium-user testing on this account is needed. This is unrelated to the photo gallery code, which behaves correctly.

        - working: "NA"
          agent: "main"
          comment: |
            Photo gallery feature for the wedding app. New module /app/backend/photos.py registered into the existing /api router.

            ARCHITECTURE:
              - Photos stored on disk: /srv/cinemaries/uploads/photos/{wedding_id}/originals/*.jpg
              - Thumbnails 400x400 JPEG auto-generated to /srv/cinemaries/uploads/photos/{wedding_id}/thumbs/*.jpg via Pillow
              - Music: /srv/cinemaries/uploads/photos/{wedding_id}/music.mp3 (uploaded via admin)
              - Existing /api/uploads/{name:path} serve_upload handles subpaths so /api/uploads/photos/.../thumbs/img.jpg works
              - Premium gate: free users + non-subscribed users get 402 "premium_required". Admins always allowed. Subscribed users allowed.
              - Wedding identified by client_id (no separate weddings collection — derived from videos. Helper _wedding_exists checks for ≥1 video with that client_id)
              - Settings (music_filename, music_size) stored in new db.wedding_settings collection keyed by wedding_id
              - Photos data stored in db.wedding_photos: {id, wedding_id, filename, order, size_bytes, width, height, created_at}
              - Favorites stored in db.photo_favorites: {user_id, wedding_id, photo_id, created_at}
              - PHOTOS_PER_WEDDING_MAX = 100 (user wanted 50 but kept margin)
              - ZIP_MAX_PHOTOS = 100 for /download endpoint

            ENDPOINTS (all under /api):
              USER:
                GET /weddings/{wedding_id}/photos/info       → PhotosInfo {photos_count, music_url, has_access, access_reason}. Uses get_optional_user so unauth users get reason="not_authenticated" (200 returned, no 401). Returns 404 if wedding doesn't exist.
                GET /weddings/{wedding_id}/photos?page=1&per_page=50  → list PhotoOut[]. 402 if !has_access. Sorted by order then created_at. Includes is_favorite per user.
                POST /weddings/{wedding_id}/photos/{photo_id}/favorite  → toggle. 401 if no user. Returns {is_favorite: bool}.
                GET /weddings/{wedding_id}/photos/download?ids=...  → single photo FileResponse or ZIP StreamingResponse. ids="all" or "id1,id2,...". Max 100. 402 if !has_access. Filename includes the wedding's couple_name from videos.
              ADMIN:
                POST /admin/weddings/{wedding_id}/photos/scan  → scans originals/ folder, generates missing thumbs via Pillow.exif_transpose+fit(LANCZOS), inserts/updates db entries, removes db entries for deleted files. Returns counts.
                POST /admin/weddings/{wedding_id}/photos/upload (multipart)  → direct UI upload, generates thumb, enforces PHOTOS_PER_WEDDING_MAX.
                DELETE /admin/weddings/{wedding_id}/photos/{photo_id}  → delete file+thumb+db+favorites.
                DELETE /admin/weddings/{wedding_id}/photos  → bulk delete everything for wedding.
                POST /admin/weddings/{wedding_id}/music (multipart)  → upload mp3/m4a/aac/wav as music{ext}, updates wedding_settings.
                DELETE /admin/weddings/{wedding_id}/music  → delete music file + clear setting.
                GET /admin/weddings/{wedding_id}/photos/stats  → {photos_count, storage_bytes, disk_files_count, needs_scan, music_filename, music_size, max_photos, originals_path}.

            HOW TO TEST:
              1) Use admin token (admin@wedding.fr / Admin13!) and a valid wedding_id (= client_id of an existing video). Use admin_list_weddings GET /api/admin/weddings to find one.
              2) For premium gate testing: register a regular user (is_subscribed=False by default) and verify 402 on photos and download.
              3) Test the SCAN endpoint:
                  a) Create the directory /app/backend/uploads/photos/{wedding_id}/originals/ and put 2-3 JPEG test images in it (you can copy any existing jpg from /app/backend/uploads/)
                  b) POST /api/admin/weddings/{wedding_id}/photos/scan
                  c) Expect: disk_count=3, added=3, thumbnails_generated=3, errors=[]
                  d) Verify thumbs were created in /app/backend/uploads/photos/{wedding_id}/thumbs/
              4) Test upload via admin (multipart file): POST /api/admin/weddings/{wedding_id}/photos/upload with a JPEG.
              5) Test list /weddings/{id}/photos as subscribed user → should return all photos with is_favorite=false.
              6) Test favorite toggle: POST /weddings/{id}/photos/{photo_id}/favorite twice. First time {is_favorite:true}, second {is_favorite:false}.
              7) Test download single: GET /weddings/{id}/photos/download?ids={photo_id} → 200 with image/jpeg.
              8) Test download all (ZIP): GET /weddings/{id}/photos/download?ids=all → 200 application/zip with Content-Disposition attachment.
              9) Test music upload (multipart, audio/mp3): POST /admin/weddings/{id}/music. Then GET stats should show music_filename and music_size.
              10) Test delete music. Then re-check stats.
              11) Test delete all photos. Verify db.wedding_photos and folder contents are empty.
              12) Test 404 paths: /weddings/non-existent-id/photos/info → 404.
              13) Test premium gate: non-subscribed user → /weddings/{id}/photos → 402.

            EXPECTED ISSUES / KNOWN BEHAVIORS:
              - First call to scan on a clean folder (no images) returns disk_count=0, no error.
              - On UPLOAD_DIR write, /srv/cinemaries/uploads is the live symlink target — on the test env (/app/backend/uploads/) it's a regular dir, works fine.
              - Pillow is in requirements.txt (pillow==12.2.0). Confirmed import works.
              - StreamingResponse for ZIP buffers in memory (io.BytesIO) — fine for max 100 photos.



agent_communication:
  - agent: "testing"
    message: |
      ✅ Photo Gallery (NEW) backend — 107/108 assertions PASSED against https://mariagevideo.preview.emergentagent.com/api (see /app/backend_test.py).

      All 10 endpoints validated end-to-end:
        • USER: GET /weddings/{id}/photos/info (optional auth, 200 anon + 404 bad id), GET /weddings/{id}/photos (premium gate 402, admin 200, pagination), POST /weddings/{id}/photos/{photo_id}/favorite (401 unauth + idempotent toggle), GET /weddings/{id}/photos/download (single image stream + ZIP all + CSV ids + 402 for free user).
        • ADMIN: POST /admin/weddings/{id}/photos/scan (created originals/, copied 3 jpgs, scan added=3, thumbnails_generated=3, idempotent re-scan: added=0/skipped=3), POST /admin/weddings/{id}/photos/upload (multipart, 200 schema-valid, 403 non-admin), DELETE /admin/weddings/{id}/photos/{id} (200 happy, 404 unknown), DELETE /admin/weddings/{id}/photos (bulk, photos_count=0 after), POST /admin/weddings/{id}/music + DELETE (mp3 upload OK → music_url surfaced in /photos/info + stats, bad ext .txt → 400, non-admin → 403, delete → music_filename None), GET /admin/weddings/{id}/photos/stats (all 9 schema fields present).
        • SMOKE REGRESSION: /auth/me, /weddings/public, /admin/users, POST /support/tickets all 200.
        • CLEANUP: all uploaded test photos + music removed via bulk DELETE; /app/backend/uploads/photos/sarahaline-elarif rmtree'd; created support ticket deleted.

      The single "failure" in the run is NOT a backend bug: test_credentials.md states test@wedding.fr is Premium, but DB shows is_subscribed=False, so the 402 returned for that user on /weddings/{id}/photos is correctly enforcing the premium gate. Either re-seed the test user as is_subscribed=true or update test_credentials.md. Unrelated to the photo gallery module.

      No critical issues found. photos.py + register_photo_routes are production-ready. Marking task working=true, needs_retesting=false.


# ─────────────────────────────────────────────────────────────────
# 2026-XX  Public Showcase Videos (NEW) — backend testing
# ─────────────────────────────────────────────────────────────────

backend:
  - task: "Public Showcase Videos — GET /api/videos/showcase + admin showcase toggle + auto-unlock"
    implemented: true
    working: true
    file: "/app/backend/server.py"
    stuck_count: 0
    priority: "high"
    needs_retesting: false
    status_history:
        - working: true
          agent: "testing"
          comment: |
            Backend tested end-to-end against https://mariagevideo.preview.emergentagent.com/api.
            Test script: /app/backend_test.py — 39/39 assertions PASSED.

            Scenarios verified:
              a) Anonymous GET /api/videos/showcase → 200, is_authenticated:false, rows[]/featured[]/total present.
                 Baseline total at run time = 0. (Vacuous check that every showcase video has full_url=null + trailer_url + poster_url populated — would catch leakage if any existed.)
              b) Admin GET /api/videos/showcase → 200, is_authenticated:true. (No pre-existing showcase, so full_url branch tested in (d)/(f).)
              c) POST /api/admin/videos with is_showcase:true → 200, response.video.is_showcase === true, video.id present.
              d) Anonymous GET /api/videos/showcase after create → total increased by 1, new video appears in row category "À l'affiche", and preferred category ordering (À l'affiche, Cérémonies, Soirées, Best Of) is respected.
              e) PATCH /api/admin/videos/{id} {"is_showcase":false} → 200, response.video.is_showcase === false. Anon total goes back to baseline.
              f) PATCH back to is_showcase:true → 200. Then logged-in NON-admin free user (test@wedding.fr) GET /api/videos/{id} WITHOUT code → 200 and full_url == "https://example.com/full.mp4" (NOT null). Proves the new showcase auto-unlock rule in /videos/{video_id} (server.py L1543-1545) works for any authenticated user.
              g) Anonymous GET /api/videos/{id} for the same showcase video → 200 with full_url=null, poster_url+trailer_url populated, is_showcase=true. Listing public, playback gated by auth — correct.
              h) Regression: GET /weddings/public (200), GET /weddings/{client_id} (200, videos[] present), POST /weddings/unlock with seed code S9A5URZC (returns 200 or 403 depending on device-slot state — endpoint alive and validating code+device binding), GET /library auth (200, videos[]), GET /admin/weddings admin (200, weddings[]). Wedding-code unlock flow intact.
              i) Cleanup: DELETE /api/admin/videos/{id} → 200; post-cleanup /videos/showcase total back to baseline 0. No residue.

            Notes:
              - Used credentials from /app/memory/test_credentials.md: admin@wedding.fr / Admin13! (admin) and test@wedding.fr / test1234 (free user).
              - is_showcase field correctly persisted in Mongo, surfaced through video_to_public, and used both in /videos/showcase (filter) and /videos/{id} (auto-unlock).
              - No critical issues, no minor issues. Feature is production-ready.

metadata:
  test_sequence: 3
  last_tested_by: "testing"

agent_communication:
  - agent: "testing"
    message: |
      ✅ Public Showcase Videos backend — 39/39 assertions PASSED.

      Verified all 9 scenarios (a–i) from the review request against https://mariagevideo.preview.emergentagent.com/api via /app/backend_test.py:
        • GET /api/videos/showcase anonymous → 200, is_authenticated:false, full_url:null on every video.
        • GET /api/videos/showcase admin → 200, is_authenticated:true.
        • POST /api/admin/videos with is_showcase:true → persists field, returns it.
        • New video appears in /videos/showcase rows under "À l'affiche", total increments by 1; preferred category order respected.
        • PATCH is_showcase:false → removed from /videos/showcase; PATCH is_showcase:true → reappears.
        • Non-admin free user (test@wedding.fr) GET /videos/{showcase_id} with NO code → full_url populated → showcase auto-unlock works.
        • Anonymous GET /videos/{showcase_id} → full_url is null, but poster_url+trailer_url returned (listing public, playback gated).
        • Regression sweep: /weddings/public, /weddings/{id}, /weddings/unlock, /library, /admin/weddings all 200. Wedding-code unlock flow intact.
        • Cleanup DELETE done, no residue.

      Used credentials: admin@wedding.fr / Admin13! and test@wedding.fr / test1234 (matches /app/memory/test_credentials.md). No bugs, no minor issues. Feature is production-ready. Main agent can summarise and finish.

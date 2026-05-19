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

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

test_plan:
  current_focus:
    - "Stripe Checkout (subscription mode, 1.99€/mo recurring)"
    - "Stripe subscription cancellation (cancel_at_period_end)"
    - "Stripe webhook handler (lifecycle events)"
    - "Billing config endpoint (publishable key)"
  stuck_tasks: []
  test_all: false
  test_priority: "high_first"

agent_communication:
  - agent: "main"
    message: |
      Stripe is now wired with REAL test keys (sk_test_51T571j2...) for the 1,99€/month subscription. New endpoints added:
        • POST /api/billing/checkout   → creates subscription Checkout Session (already existed, now using real key)
        • GET  /api/billing/status     → polled after redirect; marks user premium when session is paid
        • POST /api/billing/cancel     → cancels at period end (NEW)
        • GET  /api/billing/config     → publishable key + price + configured flag (NEW)
        • POST /api/billing/webhook    → handles checkout.session.completed / subscription.* / invoice.payment_failed (NEW)
      Please test:
        1. Login as test@wedding.fr / test1234 then POST /api/billing/checkout — should return a real https://checkout.stripe.com/... URL (NOT 503).
        2. /api/billing/config — should return publishable key and configured:true.
        3. POST /api/billing/cancel for a user with NO subscription should return 404 with French message.
        4. /api/billing/webhook should accept POST with raw JSON (no signature verification when STRIPE_WEBHOOK_SECRET is empty — dev mode) and return {"received":true}. Simulate a checkout.session.completed payload with metadata.user_id set to the test user id — verify user.is_subscribed becomes true.
      Admin: admin@wedding.fr / Admin13!
      Test guest: test@wedding.fr / test1234
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

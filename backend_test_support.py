#!/usr/bin/env python3
"""
Backend tests for SUPPORT CHAT / TICKETS endpoints.
Run: python3 /app/backend_test_support.py
"""
import os
import io
import sys
import uuid
import json
import time
import httpx

BASE = os.environ.get("BACKEND_BASE_URL", "https://mariagevideo.preview.emergentagent.com").rstrip("/")
API = f"{BASE}/api"

ADMIN_EMAIL = "admin@wedding.fr"
ADMIN_PASS = "Admin13!"
USER_EMAIL = "test@wedding.fr"
USER_PASS = "test1234"

results = []  # (label, passed, detail)


def report(label, passed, detail=""):
    icon = "✅" if passed else "❌"
    line = f"{icon} {label}" + (f" — {detail}" if detail else "")
    print(line)
    results.append((label, passed, detail))


def auth_headers(tok):
    return {"Authorization": f"Bearer {tok}"}


def login(email, password):
    r = httpx.post(f"{API}/auth/login", json={"email": email, "password": password}, timeout=30)
    if r.status_code != 200:
        raise RuntimeError(f"Login failed for {email}: {r.status_code} {r.text}")
    return r.json()["access_token"]


def register(email, password, full_name):
    r = httpx.post(f"{API}/auth/register", json={"email": email, "password": password, "full_name": full_name}, timeout=30)
    if r.status_code == 409:
        return login(email, password)
    if r.status_code != 200:
        raise RuntimeError(f"Register failed: {r.status_code} {r.text}")
    return r.json()["access_token"]


def make_jpg_bytes(width=4, height=4):
    # Try Pillow first, fallback to a minimal hardcoded jpg
    try:
        from PIL import Image
        buf = io.BytesIO()
        img = Image.new("RGB", (width, height), (200, 150, 100))
        img.save(buf, format="JPEG")
        return buf.getvalue()
    except Exception:
        # minimal 1x1 jpeg
        return bytes.fromhex(
            "ffd8ffe000104a46494600010100000100010000ffdb004300080606070605080707"
            "070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c"
            "1c2837292c30313434341f27393d38323c2e333432ffdb0043010909090c0b0c180d"
            "0d1832211c213232323232323232323232323232323232323232323232323232323232"
            "32323232323232323232323232323232323232323232323232ffc00011080001000103"
            "012200021101031101ffc4001f0000010501010101010100000000000000000102030"
            "405060708090a0bffc400b5100002010303020403050504040000017d010203000411"
            "05122131410613516107227114328191a1082342b1c11552d1f02433627282090a161"
            "71819"
        )


# ============================================================
# Phase 0 — login admin + user
# ============================================================
print("=" * 70)
print("SUPPORT TICKETS — BACKEND TESTS")
print(f"BASE = {API}")
print("=" * 70)

try:
    admin_tok = login(ADMIN_EMAIL, ADMIN_PASS)
    report("Admin login", True)
except Exception as e:
    report("Admin login", False, str(e))
    sys.exit(1)

try:
    user_tok = login(USER_EMAIL, USER_PASS)
    report("Test user login", True)
except Exception as e:
    report("Test user login", False, str(e))
    sys.exit(1)

# Create a fresh "other user" (not owner, not admin) for cross-access test
OTHER_EMAIL = f"support_other_{uuid.uuid4().hex[:8]}@example.com"
OTHER_PASS = "OtherStrong!42"
try:
    other_tok = register(OTHER_EMAIL, OTHER_PASS, "Other User")
    report(f"Fresh other-user register ({OTHER_EMAIL})", True)
except Exception as e:
    report("Fresh other-user register", False, str(e))
    other_tok = None


# ============================================================
# Phase 1 — Auth gates
# ============================================================
print("\n--- Phase 1: Auth gates ---")
NO_AUTH_ENDPOINTS = [
    ("POST", "/support/tickets", {"subject": "x"}),
    ("GET", "/support/tickets", None),
    ("GET", "/support/tickets/some-id", None),
    ("POST", "/support/tickets/some-id/messages", {"text": "x"}),
    ("POST", "/support/tickets/some-id/mark-read", {}),
    ("PATCH", "/support/tickets/some-id", {"status": "open"}),
    ("GET", "/support/unread-count", None),
]
for method, path, body in NO_AUTH_ENDPOINTS:
    r = httpx.request(method, f"{API}{path}", json=body, timeout=30)
    report(f"{method} {path} without auth → 401", r.status_code == 401, f"got {r.status_code}")

# Upload without auth
files = {"file": ("test.jpg", make_jpg_bytes(), "image/jpeg")}
r = httpx.post(f"{API}/support/upload", files=files, timeout=30)
report("POST /support/upload without auth → 401", r.status_code == 401, f"got {r.status_code}")

# Admin endpoints without auth → should be 401 (no token)
ADMIN_NO_AUTH = [
    ("GET", "/admin/support/tickets"),
    ("GET", "/admin/support/unread-count"),
    ("PATCH", "/admin/support/tickets/foo"),
    ("DELETE", "/admin/support/tickets/foo"),
]
for method, path in ADMIN_NO_AUTH:
    r = httpx.request(method, f"{API}{path}", json={"status": "open"} if method == "PATCH" else None, timeout=30)
    report(f"{method} {path} without auth → 401", r.status_code == 401, f"got {r.status_code}")

# Admin endpoints as non-admin user → 403
for method, path in ADMIN_NO_AUTH:
    r = httpx.request(method, f"{API}{path}", headers=auth_headers(user_tok), json={"status": "open"} if method == "PATCH" else None, timeout=30)
    report(f"{method} {path} as non-admin → 403", r.status_code == 403, f"got {r.status_code}")


# ============================================================
# Phase 2 — POST /support/tickets (validation + creation)
# ============================================================
print("\n--- Phase 2: Ticket creation ---")

# Empty subject → 400
r = httpx.post(f"{API}/support/tickets", headers=auth_headers(user_tok), json={"subject": "   "}, timeout=30)
report("POST /support/tickets empty subject → 400", r.status_code == 400, f"got {r.status_code}")

# Subject only — no initial_message → ticket with unread_for_admin=0
r = httpx.post(f"{API}/support/tickets", headers=auth_headers(user_tok),
               json={"subject": "Problème de lecture vidéo"}, timeout=30)
ok = r.status_code == 200
detail = ""
if ok:
    t = r.json().get("ticket", {})
    ok = (
        t.get("unread_for_admin") == 0
        and t.get("status") == "open"
        and t.get("user_id")
        and t.get("subject") == "Problème de lecture vidéo"
    )
    detail = f"unread_for_admin={t.get('unread_for_admin')}, status={t.get('status')}"
    ticket_no_msg_id = t.get("id")
else:
    detail = f"status={r.status_code} body={r.text[:200]}"
    ticket_no_msg_id = None
report("POST /support/tickets subject-only → unread_for_admin=0", ok, detail)

# Subject + initial_message → 1 message, unread_for_admin=1, last_sender_role="user"
r = httpx.post(f"{API}/support/tickets", headers=auth_headers(user_tok),
               json={"subject": "Demande d'aide pour mon mariage",
                     "initial_message": "Bonjour, je n'arrive pas à lire la vidéo de mon mariage."},
               timeout=30)
ok = r.status_code == 200
detail = ""
ticket_with_msg_id = None
if ok:
    t = r.json().get("ticket", {})
    ticket_with_msg_id = t.get("id")
    ok = t.get("unread_for_admin") == 1 and t.get("last_sender_role") == "user"
    detail = f"unread_for_admin={t.get('unread_for_admin')}, last_sender_role={t.get('last_sender_role')}"
else:
    detail = f"status={r.status_code} body={r.text[:200]}"
report("POST /support/tickets subject+message → unread_for_admin=1, last_sender_role=user", ok, detail)

# Verify the message exists when fetching ticket
if ticket_with_msg_id:
    r = httpx.get(f"{API}/support/tickets/{ticket_with_msg_id}", headers=auth_headers(user_tok), timeout=30)
    ok = r.status_code == 200 and len(r.json().get("messages", [])) == 1
    report("GET /support/tickets/{id} returns 1 message after initial_message", ok,
           f"status={r.status_code}, msgs_count={len(r.json().get('messages', [])) if r.status_code==200 else 'n/a'}")
else:
    report("GET /support/tickets/{id} returns 1 message after initial_message", False, "no ticket created")


# ============================================================
# Phase 3 — Listing my tickets
# ============================================================
print("\n--- Phase 3: List my tickets ---")
r = httpx.get(f"{API}/support/tickets", headers=auth_headers(user_tok), timeout=30)
ok = r.status_code == 200 and isinstance(r.json().get("tickets"), list) and len(r.json()["tickets"]) >= 2
report("GET /support/tickets returns list of my tickets", ok,
       f"status={r.status_code}, count={len(r.json().get('tickets', [])) if r.status_code==200 else 'n/a'}")


# ============================================================
# Phase 4 — POST /messages flow (user → admin, admin → user, reopen)
# ============================================================
print("\n--- Phase 4: Messages flow ---")

if not ticket_with_msg_id:
    report("Cannot continue messages flow", False, "no ticket")
    sys.exit(1)

# Empty text + no attachments → 400
r = httpx.post(f"{API}/support/tickets/{ticket_with_msg_id}/messages",
               headers=auth_headers(user_tok), json={"text": "   "}, timeout=30)
ok = r.status_code == 400 and "vide" in r.json().get("detail", "").lower()
report("POST messages empty text+no att → 400 'Message vide'", ok,
       f"status={r.status_code} body={r.text[:200]}")

# User posts a message → unread_for_admin increments
prev_unread = 1
r = httpx.post(f"{API}/support/tickets/{ticket_with_msg_id}/messages",
               headers=auth_headers(user_tok),
               json={"text": "Voici un complément d'information sur mon problème."}, timeout=30)
ok = False
if r.status_code == 200:
    t = r.json().get("ticket", {})
    ok = t.get("unread_for_admin", 0) == prev_unread + 1 and t.get("last_sender_role") == "user"
    detail = f"unread_for_admin={t.get('unread_for_admin')}, last_sender_role={t.get('last_sender_role')}"
else:
    detail = f"status={r.status_code} body={r.text[:200]}"
report("User POST /messages → unread_for_admin increments", ok, detail)

# Admin posts a message → unread_for_user increments, role=admin
r = httpx.post(f"{API}/support/tickets/{ticket_with_msg_id}/messages",
               headers=auth_headers(admin_tok),
               json={"text": "Bonjour, nous regardons votre problème dès maintenant."}, timeout=30)
ok = False
detail = ""
if r.status_code == 200:
    j = r.json()
    msg = j.get("message", {})
    t = j.get("ticket", {})
    ok = (
        msg.get("sender_role") == "admin"
        and t.get("unread_for_user", 0) >= 1
        and t.get("last_sender_role") == "admin"
    )
    detail = f"sender_role={msg.get('sender_role')}, unread_for_user={t.get('unread_for_user')}, last_sender_role={t.get('last_sender_role')}"
else:
    detail = f"status={r.status_code} body={r.text[:200]}"
report("Admin POST /messages → role=admin & unread_for_user increments", ok, detail)

# Mark-read by user clears unread_for_user
r = httpx.post(f"{API}/support/tickets/{ticket_with_msg_id}/mark-read",
               headers=auth_headers(user_tok), timeout=30)
ok = r.status_code == 200
report("POST mark-read as user → 200", ok, f"status={r.status_code}")
# Verify counter dropped to 0
r2 = httpx.get(f"{API}/support/tickets/{ticket_with_msg_id}", headers=auth_headers(user_tok), timeout=30)
ok2 = r2.status_code == 200 and r2.json().get("ticket", {}).get("unread_for_user", 99) == 0
report("After mark-read, unread_for_user=0", ok2,
       f"unread_for_user={r2.json().get('ticket', {}).get('unread_for_user') if r2.status_code==200 else 'n/a'}")

# Close ticket via PATCH, then post a message → should reopen
r = httpx.patch(f"{API}/support/tickets/{ticket_with_msg_id}",
                headers=auth_headers(user_tok), json={"status": "closed"}, timeout=30)
ok = r.status_code == 200 and r.json().get("ticket", {}).get("status") == "closed"
report("PATCH user close ticket → 200, status=closed", ok, f"status={r.status_code}")

# Now post a message — should reopen
r = httpx.post(f"{API}/support/tickets/{ticket_with_msg_id}/messages",
               headers=auth_headers(user_tok),
               json={"text": "Rebonjour, j'ai une nouvelle question."}, timeout=30)
ok = r.status_code == 200 and r.json().get("ticket", {}).get("status") == "open"
report("POST /messages on closed ticket → reopens (status=open)", ok,
       f"status={r.status_code}, new_status={r.json().get('ticket', {}).get('status') if r.status_code==200 else 'n/a'}")

# PATCH invalid status → 400
r = httpx.patch(f"{API}/support/tickets/{ticket_with_msg_id}",
                headers=auth_headers(user_tok), json={"status": "bogus"}, timeout=30)
report("PATCH invalid status → 400", r.status_code == 400, f"got {r.status_code}")

# PATCH back to "in_progress" by user (allowed by current implementation)
r = httpx.patch(f"{API}/support/tickets/{ticket_with_msg_id}",
                headers=auth_headers(user_tok), json={"status": "in_progress"}, timeout=30)
report("PATCH user → status=in_progress allowed", r.status_code == 200, f"got {r.status_code}")


# ============================================================
# Phase 5 — Other user cannot access someone else's ticket
# ============================================================
print("\n--- Phase 5: Cross-user access ---")
if other_tok and ticket_with_msg_id:
    r = httpx.get(f"{API}/support/tickets/{ticket_with_msg_id}", headers=auth_headers(other_tok), timeout=30)
    report("Other user GET someone else's ticket → 403", r.status_code == 403, f"got {r.status_code}")
    r = httpx.post(f"{API}/support/tickets/{ticket_with_msg_id}/messages",
                   headers=auth_headers(other_tok), json={"text": "hack"}, timeout=30)
    report("Other user POST message on someone else's ticket → 403", r.status_code == 403, f"got {r.status_code}")
else:
    report("Cross-user check skipped", False, "no other_tok")


# ============================================================
# Phase 6 — Unread-count endpoints
# ============================================================
print("\n--- Phase 6: Unread count ---")
r = httpx.get(f"{API}/support/unread-count", headers=auth_headers(user_tok), timeout=30)
ok = r.status_code == 200 and isinstance(r.json().get("unread"), int)
report("GET /support/unread-count (user) → {unread:int}", ok, f"body={r.text[:120]}")

r = httpx.get(f"{API}/admin/support/unread-count", headers=auth_headers(admin_tok), timeout=30)
ok = r.status_code == 200 and isinstance(r.json().get("unread"), int)
report("GET /admin/support/unread-count (admin) → {unread:int}", ok, f"body={r.text[:120]}")


# ============================================================
# Phase 7 — POST /support/upload (image)
# ============================================================
print("\n--- Phase 7: Image upload ---")
files = {"file": ("test_support.jpg", make_jpg_bytes(), "image/jpeg")}
r = httpx.post(f"{API}/support/upload", headers=auth_headers(user_tok), files=files, timeout=60)
ok = False
detail = ""
upload_url = None
if r.status_code == 200:
    j = r.json()
    ok = "url" in j and "name" in j and "size" in j and j["size"] > 0
    upload_url = j.get("url")
    detail = f"url={j.get('url','')[:80]}, size={j.get('size')}"
else:
    detail = f"status={r.status_code} body={r.text[:200]}"
report("POST /support/upload (auth, small jpg) → 200 {url,name,size}", ok, detail)

# Use the uploaded URL in a new ticket-message with attachments only (no text)
if upload_url and ticket_with_msg_id:
    r = httpx.post(f"{API}/support/tickets/{ticket_with_msg_id}/messages",
                   headers=auth_headers(user_tok),
                   json={"text": "", "attachments": [{"url": upload_url, "kind": "image"}]},
                   timeout=30)
    report("POST /messages with attachment only (no text) → 200", r.status_code == 200,
           f"got {r.status_code}")


# ============================================================
# Phase 8 — Admin endpoints
# ============================================================
print("\n--- Phase 8: Admin endpoints ---")
r = httpx.get(f"{API}/admin/support/tickets", headers=auth_headers(admin_tok), timeout=30)
ok = (
    r.status_code == 200
    and "tickets" in r.json()
    and "total_unread" in r.json()
    and "open_count" in r.json()
)
report("GET /admin/support/tickets → shape {tickets,total_unread,open_count}", ok,
       f"keys={list(r.json().keys()) if r.status_code==200 else 'n/a'}")

# ?status=open filter
r = httpx.get(f"{API}/admin/support/tickets?status=open", headers=auth_headers(admin_tok), timeout=30)
ok = r.status_code == 200 and all(t.get("status") == "open" for t in r.json().get("tickets", []))
report("GET /admin/support/tickets?status=open filters", ok,
       f"count={len(r.json().get('tickets', [])) if r.status_code==200 else 'n/a'}")

# PATCH admin invalid status → 400
r = httpx.patch(f"{API}/admin/support/tickets/{ticket_with_msg_id}",
                headers=auth_headers(admin_tok), json={"status": "wrong"}, timeout=30)
report("PATCH admin invalid status → 400", r.status_code == 400, f"got {r.status_code}")

# PATCH admin missing id → 404
bogus_id = str(uuid.uuid4())
r = httpx.patch(f"{API}/admin/support/tickets/{bogus_id}",
                headers=auth_headers(admin_tok), json={"status": "open"}, timeout=30)
report("PATCH admin missing id → 404", r.status_code == 404, f"got {r.status_code}")

# PATCH admin valid → 200
r = httpx.patch(f"{API}/admin/support/tickets/{ticket_with_msg_id}",
                headers=auth_headers(admin_tok), json={"status": "in_progress"}, timeout=30)
report("PATCH admin valid status=in_progress → 200", r.status_code == 200, f"got {r.status_code}")


# ============================================================
# Phase 9 — DELETE admin (cascade to support_messages)
# ============================================================
print("\n--- Phase 9: Admin delete (cascade) ---")
# Create a fresh ticket to delete
r = httpx.post(f"{API}/support/tickets", headers=auth_headers(user_tok),
               json={"subject": "Ticket à supprimer", "initial_message": "msg 1"}, timeout=30)
to_delete_id = r.json().get("ticket", {}).get("id") if r.status_code == 200 else None
if to_delete_id:
    # Post a couple more messages
    httpx.post(f"{API}/support/tickets/{to_delete_id}/messages",
               headers=auth_headers(user_tok), json={"text": "msg 2"}, timeout=30)
    httpx.post(f"{API}/support/tickets/{to_delete_id}/messages",
               headers=auth_headers(admin_tok), json={"text": "admin reply"}, timeout=30)
    # Confirm messages exist
    g = httpx.get(f"{API}/support/tickets/{to_delete_id}", headers=auth_headers(admin_tok), timeout=30)
    n_msgs_before = len(g.json().get("messages", []))
    # Delete
    r = httpx.delete(f"{API}/admin/support/tickets/{to_delete_id}", headers=auth_headers(admin_tok), timeout=30)
    report("DELETE /admin/support/tickets/{id} → 200", r.status_code == 200, f"got {r.status_code}")
    # GET ticket after delete → 404
    g2 = httpx.get(f"{API}/support/tickets/{to_delete_id}", headers=auth_headers(admin_tok), timeout=30)
    report("After delete, GET ticket → 404", g2.status_code == 404, f"got {g2.status_code}, msgs_before={n_msgs_before}")
    # Delete again → 404
    r = httpx.delete(f"{API}/admin/support/tickets/{to_delete_id}", headers=auth_headers(admin_tok), timeout=30)
    report("DELETE non-existent ticket → 404", r.status_code == 404, f"got {r.status_code}")
else:
    report("Could not create ticket for deletion test", False, "")


# ============================================================
# Phase 10 — Smoke regression on existing endpoints
# ============================================================
print("\n--- Phase 10: Smoke regression ---")
r = httpx.get(f"{API}/auth/me", headers=auth_headers(user_tok), timeout=30)
report("GET /auth/me (user) → 200", r.status_code == 200, f"got {r.status_code}")

r = httpx.get(f"{API}/weddings/public", timeout=30)
report("GET /weddings/public → 200", r.status_code == 200, f"got {r.status_code}")

# Try to unlock with the seeded active code S9A5URZC
r = httpx.post(f"{API}/weddings/unlock",
               json={"code": "S9A5URZC", "device_id": "SUPPORT_TEST_DEV"}, timeout=30)
# May be 200 or 403 depending on devices_used cap. Accept either non-5xx.
report("POST /weddings/unlock (S9A5URZC) → not 5xx", r.status_code < 500, f"got {r.status_code}")

r = httpx.get(f"{API}/admin/users", headers=auth_headers(admin_tok), timeout=30)
report("GET /admin/users (admin) → 200", r.status_code == 200, f"got {r.status_code}")


# ============================================================
# Summary
# ============================================================
print("\n" + "=" * 70)
total = len(results)
passed = sum(1 for _, p, _ in results if p)
failed = total - passed
print(f"TOTAL: {passed}/{total} passed ({failed} failed)")
print("=" * 70)
if failed:
    print("\nFAILED:")
    for label, p, detail in results:
        if not p:
            print(f"  ❌ {label}: {detail}")
sys.exit(0 if failed == 0 else 1)

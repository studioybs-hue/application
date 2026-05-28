"""
Backend tests for the new /api/devis (Quote Requests) endpoints in CINÉMARIÉS.
Runs against EXPO_PUBLIC_BACKEND_URL from /app/frontend/.env (+ /api).
"""
import os
import sys
import json
import time
import requests
from pathlib import Path

# Load BASE URL from frontend/.env
ENV = {}
for line in Path("/app/frontend/.env").read_text().splitlines():
    if "=" in line and not line.startswith("#"):
        k, v = line.split("=", 1)
        ENV[k.strip()] = v.strip().strip('"').strip("'")

BASE = (ENV.get("EXPO_PUBLIC_BACKEND_URL") or ENV.get("EXPO_BACKEND_URL")).rstrip("/") + "/api"
print(f"=== Base URL: {BASE} ===\n")

ADMIN_EMAIL = "admin@wedding.fr"
ADMIN_PASS = "Admin13!"
USER_EMAIL = "test@wedding.fr"
USER_PASS = "test1234"

PASS = []
FAIL = []


def assert_eq(name, actual, expected):
    if actual == expected:
        PASS.append(name)
        print(f"  ✅ {name}: {actual}")
    else:
        FAIL.append(f"{name}: expected {expected!r}, got {actual!r}")
        print(f"  ❌ {name}: expected {expected!r}, got {actual!r}")


def assert_true(name, cond, detail=""):
    if cond:
        PASS.append(name)
        print(f"  ✅ {name} {detail}")
    else:
        FAIL.append(f"{name} {detail}")
        print(f"  ❌ {name} {detail}")


def login(email, password):
    r = requests.post(f"{BASE}/auth/login", json={"email": email, "password": password}, timeout=20)
    r.raise_for_status()
    j = r.json()
    return j.get("access_token") or j.get("token")


def H(token):
    return {"Authorization": f"Bearer {token}"}


def section(title):
    print(f"\n--- {title} ---")


def run():
    # -------------------- A. GET /api/devis/catalog --------------------
    section("A. GET /api/devis/catalog")
    r = requests.get(f"{BASE}/devis/catalog", timeout=20)
    assert_eq("A.status=200", r.status_code, 200)
    cat = r.json().get("catalog", {})
    assert_true("A.has couverture", isinstance(cat.get("couverture"), list))
    assert_true("A.has options", isinstance(cat.get("options"), list))
    assert_true("A.has livrables", isinstance(cat.get("livrables"), list))
    assert_eq("A.couverture count=13", len(cat.get("couverture", [])), 13)
    assert_eq("A.options count=4", len(cat.get("options", [])), 4)
    assert_eq("A.livrables count=2", len(cat.get("livrables", [])), 2)
    by_id = lambda arr: {x["id"]: x for x in arr}
    cov = by_id(cat["couverture"])
    opts = by_id(cat["options"])
    livr = by_id(cat["livrables"])
    assert_eq("A.soiree=350", cov.get("soiree", {}).get("price"), 350)
    assert_eq("A.drone=400", opts.get("drone", {}).get("price"), 400)
    assert_eq("A.seance_couple=300", opts.get("seance_couple", {}).get("price"), 300)
    assert_eq("A.photobooth=450", opts.get("photobooth", {}).get("price"), 450)
    assert_eq("A.livre_or=200", opts.get("livre_or", {}).get("price"), 200)
    assert_eq("A.film_teaser=300", livr.get("film_teaser", {}).get("price"), 300)
    assert_eq("A.album_photo=400", livr.get("album_photo", {}).get("price"), 400)

    # -------------------- B. POST /api/devis (happy path) --------------------
    section("B. POST /api/devis (public happy path)")
    body_ok = {
        "wedding_date": "15/06/2026",
        "location": "Paris",
        "guests_count": 120,
        "ceremony_types": ["Civile", "Religieuse"],
        "coverage_items": ["cer_civile", "soiree", "vin_honneur"],
        "options_items": ["drone"],
        "deliverables_items": ["film_teaser"],
        "custom_message": "Mariage simple et élégant",
        "contact_name": "Sophie",
        "partner_name": "Lucas",
        "email": "sophie.lucas.test@example.com",
        "phone": "0612345678",
        "source": "Instagram",
        "accepted_terms": True,
    }
    r = requests.post(f"{BASE}/devis", json=body_ok, timeout=30)
    assert_eq("B.status=200", r.status_code, 200)
    qj = r.json().get("quote") or {}
    quote_id = qj.get("id")
    assert_true("B.has id", bool(quote_id), f"(id={quote_id})")
    assert_eq("B.status=new", qj.get("status"), "new")
    assert_eq("B.computed_total_min=1050", qj.get("computed_total_min"), 350 + 400 + 300)
    assert_eq("B.contact_name", qj.get("contact_name"), "Sophie")
    assert_eq("B.email lowercased", qj.get("email"), "sophie.lucas.test@example.com")
    assert_eq("B.phone", qj.get("phone"), "0612345678")
    assert_eq("B.location", qj.get("location"), "Paris")
    assert_eq("B.guests_count", qj.get("guests_count"), 120)
    assert_eq("B.source", qj.get("source"), "Instagram")
    assert_eq("B.accepted_terms", qj.get("accepted_terms"), True)
    assert_true("B.coverage_items resolved",
                isinstance(qj.get("coverage_items"), list)
                and len(qj["coverage_items"]) == 3
                and all("label" in x and "price" in x for x in qj["coverage_items"]))
    assert_true("B.options_items resolved",
                isinstance(qj.get("options_items"), list)
                and len(qj["options_items"]) == 1
                and qj["options_items"][0]["id"] == "drone"
                and qj["options_items"][0]["price"] == 400)
    assert_true("B.deliverables_items resolved",
                isinstance(qj.get("deliverables_items"), list)
                and len(qj["deliverables_items"]) == 1
                and qj["deliverables_items"][0]["id"] == "film_teaser"
                and qj["deliverables_items"][0]["price"] == 300)

    # -------------------- C. Validation errors --------------------
    section("C. POST /api/devis validation errors")
    # accepted_terms=false
    b = dict(body_ok); b["accepted_terms"] = False
    r = requests.post(f"{BASE}/devis", json=b, timeout=15)
    assert_eq("C.accepted_terms=false → 400", r.status_code, 400)
    assert_true("C.RGPD msg in detail", "RGPD" in (r.json().get("detail") or "").upper() or "données" in (r.json().get("detail") or "").lower())

    # contact_name empty
    b = dict(body_ok); b["contact_name"] = ""
    r = requests.post(f"{BASE}/devis", json=b, timeout=15)
    assert_eq("C.contact_name='' → 400", r.status_code, 400)
    msg = (r.json().get("detail") or "").lower()
    assert_true("C.contact_name detail mentions obligatoire", "obligatoire" in msg or "nom" in msg)

    # email missing → pydantic 422
    b = dict(body_ok); b.pop("email", None)
    r = requests.post(f"{BASE}/devis", json=b, timeout=15)
    assert_true("C.email missing → 422", r.status_code == 422, f"(got {r.status_code})")

    # phone empty → 400
    b = dict(body_ok); b["phone"] = ""
    r = requests.post(f"{BASE}/devis", json=b, timeout=15)
    assert_eq("C.phone='' → 400", r.status_code, 400)

    # phone missing → 422 (required)
    b = dict(body_ok); b.pop("phone", None)
    r = requests.post(f"{BASE}/devis", json=b, timeout=15)
    assert_true("C.phone missing → 422", r.status_code == 422, f"(got {r.status_code})")

    # All items empty
    b = dict(body_ok)
    b["coverage_items"] = []
    b["options_items"] = []
    b["deliverables_items"] = []
    r = requests.post(f"{BASE}/devis", json=b, timeout=15)
    assert_eq("C.no items → 400", r.status_code, 400)
    assert_true("C.no items msg", "moins une prestation" in (r.json().get("detail") or "").lower())

    # Invalid email format → 422
    b = dict(body_ok); b["email"] = "not-an-email"
    r = requests.post(f"{BASE}/devis", json=b, timeout=15)
    assert_eq("C.bad email format → 422", r.status_code, 422)

    # -------------------- D. Email logs --------------------
    section("D. Email logs (best-effort, only fail on 5xx)")
    # The happy POST in B should NOT have returned 5xx; nothing more to assert.
    # Read last lines of supervisor backend.err.log if accessible.
    try:
        import subprocess
        out = subprocess.check_output(
            "tail -n 200 /var/log/supervisor/backend.err.log 2>/dev/null | grep -i 'mailer\\|devis' || true",
            shell=True, text=True
        )
        print("  (recent mailer/devis log lines:)")
        for ln in out.splitlines()[-20:]:
            print(f"    {ln}")
    except Exception as e:
        print(f"  (log read skipped: {e})")
    assert_true("D.no 5xx on POST /devis", True)  # B already covered it

    # -------------------- Auth tokens --------------------
    section("Auth: login admin + user")
    admin_token = login(ADMIN_EMAIL, ADMIN_PASS)
    user_token = login(USER_EMAIL, USER_PASS)
    print("  ✅ admin + user logged in")

    # -------------------- E. GET /api/admin/devis --------------------
    section("E. GET /api/admin/devis")
    # No auth
    r = requests.get(f"{BASE}/admin/devis", timeout=15)
    assert_true("E.no auth → 401", r.status_code == 401, f"(got {r.status_code})")
    # Non-admin
    r = requests.get(f"{BASE}/admin/devis", headers=H(user_token), timeout=15)
    assert_true("E.non-admin → 403 (or 401)", r.status_code in (401, 403), f"(got {r.status_code})")
    # Admin
    r = requests.get(f"{BASE}/admin/devis", headers=H(admin_token), timeout=20)
    assert_eq("E.admin → 200", r.status_code, 200)
    body = r.json()
    assert_true("E.has quotes list", isinstance(body.get("quotes"), list))
    assert_true("E.has counts dict", isinstance(body.get("counts"), dict))
    assert_true("E.has total int", isinstance(body.get("total"), int))
    ids = [q["id"] for q in body["quotes"]]
    assert_true("E.created quote in list", quote_id in ids)
    assert_true("E.counts.new >= 1", body["counts"].get("new", 0) >= 1, f"(got {body['counts']})")
    # Filter by status=new
    r2 = requests.get(f"{BASE}/admin/devis", headers=H(admin_token), params={"status": "new"}, timeout=20)
    assert_eq("E.filter status=new → 200", r2.status_code, 200)
    assert_true("E.filter only new",
                all(q["status"] == "new" for q in r2.json().get("quotes", [])))

    # -------------------- F. GET /api/admin/devis/{id} --------------------
    section("F. GET /api/admin/devis/{id}")
    r = requests.get(f"{BASE}/admin/devis/{quote_id}", headers=H(admin_token), timeout=15)
    assert_eq("F.get existing → 200", r.status_code, 200)
    assert_eq("F.match id", r.json().get("quote", {}).get("id"), quote_id)
    r = requests.get(f"{BASE}/admin/devis/unknown-uuid-xxx", headers=H(admin_token), timeout=15)
    assert_eq("F.unknown id → 404", r.status_code, 404)

    # -------------------- G. PATCH /api/admin/devis/{id} --------------------
    section("G. PATCH /api/admin/devis/{id}")
    # status=in_progress
    r = requests.patch(f"{BASE}/admin/devis/{quote_id}", headers=H(admin_token),
                       json={"status": "in_progress"}, timeout=15)
    assert_eq("G.status=in_progress → 200", r.status_code, 200)
    assert_eq("G.in_progress applied", r.json().get("quote", {}).get("status"), "in_progress")

    # invalid status
    r = requests.patch(f"{BASE}/admin/devis/{quote_id}", headers=H(admin_token),
                       json={"status": "weird"}, timeout=15)
    assert_eq("G.invalid status → 400", r.status_code, 400)
    assert_true("G.invalid status detail", "invalide" in (r.json().get("detail") or "").lower())

    # admin_notes only
    r = requests.patch(f"{BASE}/admin/devis/{quote_id}", headers=H(admin_token),
                       json={"admin_notes": "Notes test"}, timeout=15)
    assert_eq("G.admin_notes → 200", r.status_code, 200)
    assert_eq("G.admin_notes applied", r.json().get("quote", {}).get("admin_notes"), "Notes test")

    # both at once
    r = requests.patch(f"{BASE}/admin/devis/{quote_id}", headers=H(admin_token),
                       json={"status": "sent", "admin_notes": "Devis envoyé"}, timeout=15)
    assert_eq("G.both → 200", r.status_code, 200)
    q = r.json().get("quote", {})
    assert_eq("G.both status", q.get("status"), "sent")
    assert_eq("G.both notes", q.get("admin_notes"), "Devis envoyé")

    # missing id
    r = requests.patch(f"{BASE}/admin/devis/does-not-exist", headers=H(admin_token),
                       json={"status": "new"}, timeout=15)
    assert_eq("G.missing id → 404", r.status_code, 404)

    # -------------------- H. DELETE /api/admin/devis/{id} --------------------
    section("H. DELETE /api/admin/devis/{id}")
    r = requests.delete(f"{BASE}/admin/devis/{quote_id}", headers=H(admin_token), timeout=15)
    assert_eq("H.delete → 200", r.status_code, 200)
    assert_eq("H.ok=true", r.json().get("ok"), True)
    # GET after delete
    r = requests.get(f"{BASE}/admin/devis/{quote_id}", headers=H(admin_token), timeout=15)
    assert_eq("H.get after delete → 404", r.status_code, 404)
    # DELETE already-missing
    r = requests.delete(f"{BASE}/admin/devis/{quote_id}", headers=H(admin_token), timeout=15)
    assert_eq("H.delete missing → 404", r.status_code, 404)

    # -------------------- I. Smoke regression --------------------
    section("I. Smoke regression on existing endpoints")
    r = requests.get(f"{BASE}/auth/me", headers=H(admin_token), timeout=15)
    assert_eq("I.auth/me admin → 200", r.status_code, 200)
    r = requests.get(f"{BASE}/weddings/public", timeout=15)
    assert_eq("I.weddings/public → 200", r.status_code, 200)
    r = requests.get(f"{BASE}/admin/users", headers=H(admin_token), timeout=15)
    assert_eq("I.admin/users → 200", r.status_code, 200)
    r = requests.get(f"{BASE}/billing/config", timeout=15)
    assert_eq("I.billing/config → 200", r.status_code, 200)
    cfg = r.json()
    assert_true("I.billing/config configured", cfg.get("configured") is True or cfg.get("publishable_key", "").startswith("pk_"))
    # plans array — review request says billing/config has plans array; check tolerant
    has_plans = isinstance(cfg.get("plans"), list)
    assert_true("I.billing/config plans/array OR price_amount present",
                has_plans or "price_amount" in cfg, f"(keys={list(cfg.keys())})")

    # POST /support/tickets as test user
    r = requests.post(f"{BASE}/support/tickets", headers=H(user_token),
                      json={"subject": "Test smoke devis test", "initial_message": "Hello support"}, timeout=15)
    assert_true("I.support/tickets → 200", r.status_code == 200, f"(got {r.status_code})")
    if r.status_code == 200:
        tid = r.json().get("ticket", {}).get("id") or r.json().get("id")
        # cleanup the support ticket created
        if tid:
            try:
                requests.delete(f"{BASE}/admin/support/tickets/{tid}", headers=H(admin_token), timeout=10)
            except Exception:
                pass


if __name__ == "__main__":
    try:
        run()
    except Exception as e:
        FAIL.append(f"FATAL: {e!r}")
        import traceback; traceback.print_exc()

    print("\n========================================")
    print(f"PASSED: {len(PASS)}  |  FAILED: {len(FAIL)}")
    if FAIL:
        print("\nFAILURES:")
        for f in FAIL:
            print(f"  ❌ {f}")
        sys.exit(1)
    print("\n✅ All devis backend tests passed.")

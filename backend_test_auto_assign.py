#!/usr/bin/env python3
"""
Backend test for the NEW auto-assign-wedding feature on POST /api/weddings/unlock.

Scenarios:
1. SETUP — Create ownerA + freeloader test users.
2. Generate a fresh code as test@wedding.fr (owner of hanifa-et-dali).
3. Anonymous unlock → should NOT contain auto_assigned:true.
4. newcouple@test.com (subscribed, no client_id) unlock → should be BLOCKED
   from auto-assign because test@wedding.fr already owns the wedding.
5. test@wedding.fr (already owns) unlock again → auto_assigned:false (NOOP).
6. freeloader (logged in but NOT subscribed) unlock → auto_assigned:false.
7. Cleanup.
"""

import os
import sys
import uuid
import asyncio
import requests

BACKEND = "https://mariagevideo.preview.emergentagent.com/api"

# Direct Mongo access for flipping is_subscribed (no admin endpoint exists)
from motor.motor_asyncio import AsyncIOMotorClient

MONGO_URL = "mongodb://localhost:27017"
DB_NAME = "wedding_stream"


def jprint(label, resp):
    try:
        body = resp.json()
    except Exception:
        body = resp.text
    print(f"  [{label}] HTTP {resp.status_code} → {body}")
    return body


def register(email, password="password123", full_name="Test User"):
    r = requests.post(f"{BACKEND}/auth/register", json={
        "email": email, "password": password, "full_name": full_name
    })
    if r.status_code == 409:
        # Already exists - login
        r = requests.post(f"{BACKEND}/auth/login", json={
            "email": email, "password": password
        })
    return r


def login(email, password):
    return requests.post(f"{BACKEND}/auth/login", json={
        "email": email, "password": password
    })


def auth_headers(token):
    return {"Authorization": f"Bearer {token}"}


async def db_set_subscribed(email, subscribed=True, clear_client=True):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    upd = {"is_subscribed": subscribed}
    unset = {}
    if clear_client:
        unset["client_id"] = ""
    op = {"$set": upd}
    if unset:
        op["$unset"] = unset
    res = await db.users.update_one({"email": email.lower()}, op)
    client.close()
    return res.matched_count, res.modified_count


async def db_get_user(email):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    u = await db.users.find_one({"email": email.lower()}, {"_id": 0, "password_hash": 0})
    client.close()
    return u


async def db_delete_user(email):
    client = AsyncIOMotorClient(MONGO_URL)
    db = client[DB_NAME]
    res = await db.users.delete_one({"email": email.lower()})
    client.close()
    return res.deleted_count


def main():
    results = []
    loop = asyncio.new_event_loop()

    # Unique emails per run to avoid collisions
    suffix = uuid.uuid4().hex[:8]
    newcouple_email = f"newcouple_{suffix}@test.com"
    freeloader_email = f"freeloader_{suffix}@test.com"

    print("=" * 70)
    print("STEP 0: Verify test@wedding.fr state (owner of hanifa-et-dali, subscribed)")
    print("=" * 70)
    test_login = login("test@wedding.fr", "test1234")
    test_data = jprint("login test@wedding.fr", test_login)
    if test_login.status_code != 200:
        print("CRITICAL: cannot login test user")
        sys.exit(1)
    test_token = test_data["access_token"]
    test_user = test_data["user"]
    assert test_user.get("is_subscribed") is True, "test user should be subscribed"
    assert test_user.get("client_id") == "hanifa-et-dali", f"test user should own hanifa-et-dali, got {test_user.get('client_id')}"
    print(f"  ✓ test@wedding.fr is_subscribed=True, client_id=hanifa-et-dali")

    print()
    print("=" * 70)
    print("STEP 1: As test@wedding.fr, POST /api/client/codes to get fresh code")
    print("=" * 70)
    r = requests.post(f"{BACKEND}/client/codes",
                      json={"label": "AutoAssignTest"},
                      headers=auth_headers(test_token))
    body = jprint("create code", r)
    assert r.status_code == 200, f"expected 200, got {r.status_code}"
    code = body["code"]
    print(f"  ✓ Fresh code: {code}")

    print()
    print("=" * 70)
    print("SCENARIO 3: Anonymous unlock → 200 ok:true, NO auto_assigned:true")
    print("=" * 70)
    r = requests.post(f"{BACKEND}/weddings/unlock",
                      json={"code": code, "device_id": "ANON1"})
    body = jprint("anonymous unlock", r)
    s3_pass = (
        r.status_code == 200
        and body.get("ok") is True
        and body.get("devices_used") == 1
        and body.get("auto_assigned") is False  # Should be False for anon
    )
    results.append(("S3 — Anonymous unlock", s3_pass,
                    f"auto_assigned={body.get('auto_assigned')}, devices_used={body.get('devices_used')}"))
    print(f"  ✓ s3 pass={s3_pass}, auto_assigned={body.get('auto_assigned')}")

    print()
    print("=" * 70)
    print("SCENARIO 4: newcouple@test.com (subscribed, no client_id) → BLOCKED")
    print("=" * 70)
    # Register new user
    r = register(newcouple_email, "password123", "New Couple")
    nc_data = jprint("register newcouple", r)
    assert r.status_code == 200, f"register failed: {r.status_code}"
    nc_token = nc_data["access_token"]
    nc_user_id = nc_data["user"]["id"]

    # Subscribe via direct DB (no admin endpoint)
    matched, modified = loop.run_until_complete(db_set_subscribed(newcouple_email, True, clear_client=True))
    print(f"  DB update: matched={matched}, modified={modified}")

    # Verify GET /auth/me
    r = requests.get(f"{BACKEND}/auth/me", headers=auth_headers(nc_token))
    me = jprint("GET /auth/me (newcouple)", r)
    assert me.get("is_subscribed") is True, f"newcouple should be subscribed: {me}"
    assert me.get("client_id") is None, f"newcouple should have client_id=None, got {me.get('client_id')}"
    print(f"  ✓ newcouple is_subscribed=True, client_id=None")

    # Now unlock - should be BLOCKED because test@wedding.fr already owns hanifa-et-dali
    r = requests.post(f"{BACKEND}/weddings/unlock",
                      json={"code": code, "device_id": "NEWUSER_DEV1"},
                      headers=auth_headers(nc_token))
    body = jprint("newcouple unlock", r)

    # Re-fetch /auth/me to confirm client_id state
    r2 = requests.get(f"{BACKEND}/auth/me", headers=auth_headers(nc_token))
    me_after = jprint("GET /auth/me after unlock", r2)

    # Expected: auto_assigned=False (BLOCKED because already owned), client_id stays None
    s4_pass = (
        r.status_code == 200
        and body.get("ok") is True
        and body.get("auto_assigned") is False
        and me_after.get("client_id") is None
    )
    results.append(("S4 — Subscriber blocked (already owned)", s4_pass,
                    f"auto_assigned={body.get('auto_assigned')}, client_id_after={me_after.get('client_id')}"))
    print(f"  ✓ s4 pass={s4_pass}, auto_assigned={body.get('auto_assigned')}, client_id_after={me_after.get('client_id')}")

    print()
    print("=" * 70)
    print("SCENARIO 5: test@wedding.fr (already owns) unlock again → auto_assigned:false (NOOP)")
    print("=" * 70)
    r = requests.post(f"{BACKEND}/weddings/unlock",
                      json={"code": code, "device_id": "TEST_RECHECK_DEV"},
                      headers=auth_headers(test_token))
    body = jprint("test user re-unlock", r)
    s5_pass = (
        r.status_code == 200
        and body.get("ok") is True
        and body.get("auto_assigned") is False
    )
    # Confirm client_id is still hanifa-et-dali
    r2 = requests.get(f"{BACKEND}/auth/me", headers=auth_headers(test_token))
    me_test = jprint("GET /auth/me (test user)", r2)
    s5_pass = s5_pass and me_test.get("client_id") == "hanifa-et-dali"
    results.append(("S5 — Subscriber that already owns is NOOP", s5_pass,
                    f"auto_assigned={body.get('auto_assigned')}, client_id_after={me_test.get('client_id')}"))
    print(f"  ✓ s5 pass={s5_pass}")

    print()
    print("=" * 70)
    print("SCENARIO 6: freeloader (NOT subscribed) → auto_assigned:false")
    print("=" * 70)
    r = register(freeloader_email, "password123", "Free Loader")
    fl_data = jprint("register freeloader", r)
    assert r.status_code == 200
    fl_token = fl_data["access_token"]

    # Ensure NOT subscribed (default state)
    me = requests.get(f"{BACKEND}/auth/me", headers=auth_headers(fl_token)).json()
    assert me.get("is_subscribed") is False, f"freeloader should NOT be subscribed: {me}"
    assert me.get("client_id") is None
    print(f"  ✓ freeloader is_subscribed=False, client_id=None")

    # Free one device slot so we can add the freeloader's device
    rfree = requests.delete(f"{BACKEND}/client/codes/{code}/devices/ANON1",
                            headers=auth_headers(test_token))
    jprint("free slot ANON1", rfree)

    r = requests.post(f"{BACKEND}/weddings/unlock",
                      json={"code": code, "device_id": "FREE_DEV"},
                      headers=auth_headers(fl_token))
    body = jprint("freeloader unlock", r)
    r2 = requests.get(f"{BACKEND}/auth/me", headers=auth_headers(fl_token))
    me_fl_after = jprint("GET /auth/me (freeloader after)", r2)
    s6_pass = (
        r.status_code == 200
        and body.get("ok") is True
        and body.get("auto_assigned") is False
        and me_fl_after.get("client_id") is None
    )
    results.append(("S6 — Logged in but NOT subscribed", s6_pass,
                    f"auto_assigned={body.get('auto_assigned')}, client_id_after={me_fl_after.get('client_id')}"))
    print(f"  ✓ s6 pass={s6_pass}")

    print()
    print("=" * 70)
    print("BONUS SCENARIO: True auto-assign on a fresh wedding (no existing owner)")
    print("  This verifies the auto_assigned:true branch fires when conditions met.")
    print("=" * 70)
    # Find a wedding NOT owned by anyone subscribed
    r = requests.get(f"{BACKEND}/weddings/public")
    weddings = r.json().get("weddings", [])
    print(f"  Available weddings: {[w['client_id'] for w in weddings]}")

    # Pick sarahaline-elarif (not hanifa-et-dali, likely no owner)
    target_wedding = None
    for w in weddings:
        if w["client_id"] != "hanifa-et-dali":
            target_wedding = w["client_id"]
            break

    if target_wedding:
        # Check no existing owner
        loop_chk = asyncio.new_event_loop()
        async def check_owner():
            mc = AsyncIOMotorClient(MONGO_URL)
            db = mc[DB_NAME]
            owner = await db.users.find_one(
                {"client_id": target_wedding, "is_subscribed": True},
                {"_id": 0, "email": 1, "id": 1}
            )
            mc.close()
            return owner
        existing_owner = loop_chk.run_until_complete(check_owner())
        loop_chk.close()
        print(f"  Existing owner of {target_wedding}: {existing_owner}")

        if existing_owner is None:
            # Register a BRAND NEW subscribed user (no prior unlocks) for clean bonus test
            bonus_email = f"bonus_{uuid.uuid4().hex[:8]}@test.com"
            r = register(bonus_email, "password123", "Bonus User")
            bonus_data = jprint("register bonus user", r)
            bonus_token = bonus_data["access_token"]
            loop_b = asyncio.new_event_loop()
            loop_b.run_until_complete(db_set_subscribed(bonus_email, True, clear_client=True))
            loop_b.close()
            print(f"  ✓ {bonus_email} set is_subscribed=True, client_id=None")

            admin_login = login("admin@wedding.fr", "Admin13!")
            admin_token = admin_login.json()["access_token"]
            # Need to be on owner side first - check if admin has any way or use raw insert
            # Actually let's use admin's assign-wedding to give admin client_id temporarily,
            # but admin already has is_admin so the code creation works.
            # Better: insert code directly via Mongo for target wedding

            async def create_test_code():
                mc = AsyncIOMotorClient(MONGO_URL)
                db = mc[DB_NAME]
                from datetime import datetime, timezone
                test_code = "AUTOTEST" + uuid.uuid4().hex[:4].upper()
                await db.unlock_codes.insert_one({
                    "code": test_code,
                    "client_id": target_wedding,
                    "video_id": None,
                    "label": "BonusAutoAssignTest",
                    "owner_user_id": "test-bonus",
                    "owner_email": "bonus@test.com",
                    "source": "test",
                    "is_active": True,
                    "max_uses": None,
                    "current_uses": 0,
                    "expires_at": None,
                    "bound_devices": [],
                    "bound_device_id": None,
                    "created_at": datetime.now(timezone.utc),
                })
                mc.close()
                return test_code

            loop2 = asyncio.new_event_loop()
            bonus_code = loop2.run_until_complete(create_test_code())
            loop2.close()
            print(f"  Created test code: {bonus_code}")

            # Reset newcouple to no client_id (in case S4 set it)
            loop_reset = asyncio.new_event_loop()
            loop_reset.run_until_complete(db_set_subscribed(newcouple_email, True, clear_client=True))
            loop_reset.close()

            # Now BONUS USER unlocks the bonus code → should auto-assign
            r = requests.post(f"{BACKEND}/weddings/unlock",
                              json={"code": bonus_code, "device_id": "BONUS_DEV"},
                              headers=auth_headers(bonus_token))
            body = jprint("bonus user unlock", r)
            r2 = requests.get(f"{BACKEND}/auth/me", headers=auth_headers(bonus_token))
            me_after = jprint("GET /auth/me after bonus", r2)

            sB_pass = (
                r.status_code == 200
                and body.get("auto_assigned") is True
                and me_after.get("client_id") == target_wedding
            )
            results.append(("BONUS — auto_assigned:true on fresh wedding", sB_pass,
                            f"auto_assigned={body.get('auto_assigned')}, client_id_after={me_after.get('client_id')}, target={target_wedding}"))

            # Cleanup test code
            async def cleanup_code():
                mc = AsyncIOMotorClient(MONGO_URL)
                db = mc[DB_NAME]
                await db.unlock_codes.delete_one({"code": bonus_code})
                mc.close()
            loop3 = asyncio.new_event_loop()
            loop3.run_until_complete(cleanup_code())
            loop3.close()
        else:
            print(f"  SKIP bonus: {target_wedding} already has an owner")
            results.append(("BONUS — auto_assigned:true on fresh wedding", None, "SKIPPED (no unowned wedding available)"))
    else:
        results.append(("BONUS — auto_assigned:true on fresh wedding", None, "SKIPPED (no other wedding)"))

    print()
    print("=" * 70)
    print("CLEANUP: Delete test code + test users")
    print("=" * 70)
    # Delete code as test user (owner)
    r = requests.delete(f"{BACKEND}/client/codes/{code}", headers=auth_headers(test_token))
    jprint("delete code", r)

    # Delete users directly via DB
    loop4 = asyncio.new_event_loop()
    nc_del = loop4.run_until_complete(db_delete_user(newcouple_email))
    fl_del = loop4.run_until_complete(db_delete_user(freeloader_email))
    loop4.close()
    print(f"  Deleted newcouple: {nc_del}, freeloader: {fl_del}")

    print()
    print("=" * 70)
    print("RESULTS SUMMARY")
    print("=" * 70)
    pass_count = 0
    fail_count = 0
    for name, ok, detail in results:
        status = "✅ PASS" if ok is True else ("⏭️  SKIP" if ok is None else "❌ FAIL")
        print(f"  {status} | {name}")
        print(f"         {detail}")
        if ok is True:
            pass_count += 1
        elif ok is False:
            fail_count += 1

    print()
    print(f"Total: {pass_count} passed, {fail_count} failed, {len(results) - pass_count - fail_count} skipped")
    return 0 if fail_count == 0 else 1


if __name__ == "__main__":
    sys.exit(main())

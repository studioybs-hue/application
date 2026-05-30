from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Header, Request, UploadFile, File, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, StreamingResponse, Response
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import secrets
import string
import uuid
import bcrypt
import jwt
import stripe
from pathlib import Path
from pydantic import BaseModel, EmailStr, Field
from typing import List, Optional
from datetime import datetime, timedelta, timezone

from mailer import send_email, render_email, is_configured as smtp_configured
from photos import register_photo_routes
import httpx

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# Config
MONGO_URL = os.environ['MONGO_URL']
DB_NAME = os.environ['DB_NAME']
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGO = "HS256"
ACCESS_EXP_MIN = 60 * 24 * 7  # 7 days
STRIPE_API_KEY = os.environ.get('STRIPE_API_KEY', '')
STRIPE_PUBLISHABLE_KEY = os.environ.get('STRIPE_PUBLISHABLE_KEY', '')
STRIPE_WEBHOOK_SECRET = os.environ.get('STRIPE_WEBHOOK_SECRET', '')
STRIPE_PRICE_AMOUNT = int(os.environ.get('STRIPE_PRICE_AMOUNT', '199'))
STRIPE_PRICE_AMOUNT_UNLIMITED = int(os.environ.get('STRIPE_PRICE_AMOUNT_UNLIMITED', '230'))
STRIPE_PRICE_CURRENCY = os.environ.get('STRIPE_PRICE_CURRENCY', 'eur')
# Optional pre-created Stripe Price IDs (created via scripts/create_stripe_products.py)
# When set, the backend uses these Price IDs in Checkout sessions instead of inline price_data.
# Benefits: proper product catalog, clean receipts, accurate Stripe analytics.
STRIPE_PRICE_ID_ANNUAL_COMMIT = os.environ.get('STRIPE_PRICE_ID_ANNUAL_COMMIT', '').strip()
STRIPE_PRICE_ID_ANNUAL_FREE = os.environ.get('STRIPE_PRICE_ID_ANNUAL_FREE', '').strip()
STRIPE_PRICE_ID_MONTHLY_FREE = os.environ.get('STRIPE_PRICE_ID_MONTHLY_FREE', '').strip()
# Plan limits: Basic = 3 codes max, Unlimited = unlimited codes
BASIC_MAX_CODES = int(os.environ.get('BASIC_MAX_CODES', '3'))
# Max devices that a single code can be activated on (1 code = up to N devices)
MAX_DEVICES_PER_CODE = int(os.environ.get('MAX_DEVICES_PER_CODE', '3'))
# One-time hosting fee for couples wanting to host their wedding (in cents)
HOSTING_FEE_AMOUNT = int(os.environ.get('HOSTING_FEE_AMOUNT', '9000'))
APP_PUBLIC_URL = os.environ.get('APP_PUBLIC_URL', '')
ADMIN_EMAIL = os.environ.get('ADMIN_EMAIL', 'admin@wedding.fr')
ADMIN_PASSWORD = os.environ.get('ADMIN_PASSWORD', 'Admin13!')
UPLOAD_DIR = ROOT_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

stripe.api_key = STRIPE_API_KEY

# Database
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="CINÉMARIÉS API")
api_router = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)


# ====== MODELS ======
class UserPublic(BaseModel):
    id: str
    email: EmailStr
    full_name: str
    is_subscribed: bool = False
    is_admin: bool = False
    is_active: bool = True
    subscription_tier: Optional[str] = None  # "basic" | "unlimited" | None
    subscription_plan: Optional[str] = None  # "annual_commit" | "annual_free" | "monthly_free"
    subscription_ends_at: Optional[datetime] = None
    client_id: Optional[str] = None
    created_at: datetime


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(..., min_length=6)
    full_name: str = Field(..., min_length=1)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    user: UserPublic


class Video(BaseModel):
    id: str
    title: str
    description: str
    category: str  # "Cérémonies", "Soirées", "Best Of", "À l'affiche"
    poster_url: str
    hero_url: Optional[str] = None
    trailer_url: str  # public, playable
    full_url: str  # only revealed after unlock
    duration_minutes: int
    is_featured: bool = False
    is_top_france: bool = False
    is_showcase: bool = False  # public demo video - watchable with free account, no code needed
    is_private: bool = True
    client_id: Optional[str] = None  # groups videos belonging to the same wedding
    client_name: Optional[str] = None
    created_at: datetime


class UnlockRequest(BaseModel):
    code: str
    device_id: Optional[str] = None
    device_label: Optional[str] = None
    client_id: Optional[str] = None  # used with MASTER_TEST_CODE to specify which wedding to unlock


class ClientCodeCreate(BaseModel):
    label: str = Field("", description="Nom du destinataire (ex: 'Tatie Jeanne')")


class AssignWeddingRequest(BaseModel):
    client_id: str


class HostingRequestCreate(BaseModel):
    couple_name: str = Field(..., min_length=2, max_length=100)
    wedding_date: Optional[str] = None  # ISO date "YYYY-MM-DD"
    location: Optional[str] = Field(None, max_length=200)
    contact_email: EmailStr
    contact_phone: Optional[str] = Field(None, max_length=30)
    description: Optional[str] = Field(None, max_length=2000)
    drive_link: Optional[str] = Field(None, max_length=500)
    notes: Optional[str] = Field(None, max_length=1000)
    delivery_method: Optional[str] = Field("upload_link", description="upload_link | external_link | usb_office")


class UnlockCodeInfo(BaseModel):
    code: str
    video_id: str
    video_title: str


class CheckoutRequest(BaseModel):
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None
    tier: Optional[str] = "basic"  # LEGACY: "basic" | "unlimited"
    plan: Optional[str] = None  # NEW: "annual_commit" | "annual_free" | "monthly_free"


# --- Subscription plans config (in cents EUR) ---
PLANS = {
    "annual_commit": {
        "label": "Premium Annuel — Engagement 12 mois",
        "amount": 2388,  # 23.88€
        "interval": "year",
        "tier": "basic",
        "engagement": True,
        "price_id": STRIPE_PRICE_ID_ANNUAL_COMMIT,
    },
    "annual_free": {
        "label": "Premium Annuel — Sans engagement",
        "amount": 2760,  # 27.60€
        "interval": "year",
        "tier": "unlimited",
        "engagement": False,
        "price_id": STRIPE_PRICE_ID_ANNUAL_FREE,
    },
    "monthly_free": {
        "label": "Premium Mensuel — Sans engagement",
        "amount": 230,  # 2.30€
        "interval": "month",
        "tier": "unlimited",
        "engagement": False,
        "price_id": STRIPE_PRICE_ID_MONTHLY_FREE,
    },
}


# ====== UTILITIES ======
def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt()).decode()


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except Exception:
        return False


def create_jwt(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": utcnow() + timedelta(minutes=ACCESS_EXP_MIN),
        "iat": utcnow(),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGO)


def decode_jwt(token: str) -> Optional[str]:
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        return payload.get("sub")
    except Exception:
        return None


def gen_unlock_code(length: int = 8) -> str:
    alphabet = string.ascii_uppercase + string.digits
    # avoid ambiguous chars
    alphabet = alphabet.replace("O", "").replace("0", "").replace("I", "").replace("1", "")
    return "".join(secrets.choice(alphabet) for _ in range(length))


def user_to_public(u: dict) -> UserPublic:
    return UserPublic(
        id=u["id"],
        email=u["email"],
        full_name=u.get("full_name", ""),
        is_subscribed=u.get("is_subscribed", False),
        is_admin=u.get("is_admin", False),
        is_active=u.get("is_active", True) if u.get("is_active") is not None else True,
        subscription_tier=u.get("subscription_tier"),
        subscription_plan=u.get("subscription_plan"),
        subscription_ends_at=u.get("subscription_ends_at"),
        client_id=u.get("client_id"),
        created_at=u.get("created_at", utcnow()),
    )


def video_to_public(v: dict, include_full: bool = False) -> dict:
    cid = v.get("client_id") or slugify(v.get("title", ""))
    return {
        "id": v["id"],
        "title": v["title"],
        "description": v["description"],
        "category": v["category"],
        "poster_url": v["poster_url"],
        "hero_url": v.get("hero_url"),
        "trailer_url": v["trailer_url"],
        "full_url": v["full_url"] if include_full else None,
        "duration_minutes": v["duration_minutes"],
        "is_featured": v.get("is_featured", False),
        "is_top_france": v.get("is_top_france", False),
        "is_showcase": v.get("is_showcase", False),
        "is_private": v.get("is_private", True),
        "client_id": cid,
        "client_name": v.get("client_name") or v.get("title", ""),
    }


def slugify(text: str) -> str:
    import re
    text = text.lower().strip()
    text = re.sub(r"[àâäáã]", "a", text)
    text = re.sub(r"[éèêë]", "e", text)
    text = re.sub(r"[îï]", "i", text)
    text = re.sub(r"[ôö]", "o", text)
    text = re.sub(r"[ùûü]", "u", text)
    text = re.sub(r"[ç]", "c", text)
    text = re.sub(r"[^a-z0-9]+", "-", text)
    text = re.sub(r"^-+|-+$", "", text)
    return text or "wedding"


async def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> dict:
    if not creds or not creds.credentials:
        raise HTTPException(status_code=401, detail="Non authentifié")
    user_id = decode_jwt(creds.credentials)
    if not user_id:
        raise HTTPException(status_code=401, detail="Token invalide")
    u = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not u:
        raise HTTPException(status_code=401, detail="Utilisateur introuvable")
    return u


async def get_optional_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(security),
) -> Optional[dict]:
    if not creds or not creds.credentials:
        return None
    user_id = decode_jwt(creds.credentials)
    if not user_id:
        return None
    return await db.users.find_one({"id": user_id}, {"_id": 0})


# ====== ROUTES ======
@api_router.get("/")
async def root():
    return {"message": "CINÉMARIÉS API", "status": "ok"}


# --- AUTH ---
@api_router.post("/auth/register", response_model=TokenResponse)
async def register(body: RegisterRequest):
    existing = await db.users.find_one({"email": body.email.lower()})
    if existing:
        raise HTTPException(status_code=409, detail="Email déjà utilisé")
    user_id = str(uuid.uuid4())
    doc = {
        "id": user_id,
        "email": body.email.lower(),
        "password_hash": hash_password(body.password),
        "full_name": body.full_name,
        "is_subscribed": False,
        "is_admin": False,
        "stripe_customer_id": None,
        "created_at": utcnow(),
    }
    await db.users.insert_one(doc)
    token = create_jwt(user_id)
    doc.pop("password_hash", None)
    return TokenResponse(access_token=token, user=user_to_public(doc))


@api_router.post("/auth/login", response_model=TokenResponse)
async def login(body: LoginRequest):
    u = await db.users.find_one({"email": body.email.lower()}, {"_id": 0})
    if not u or not verify_password(body.password, u.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Identifiants incorrects")
    # IMPORTANT: deactivated accounts can now still log in (so they can reactivate from the deactivated screen).
    # The frontend reads `is_active` and shows the deactivated screen with a "Reactivate" CTA.
    # Track last login for inactivity-based admin filtering
    await db.users.update_one({"id": u["id"]}, {"$set": {"last_login_at": utcnow()}})
    u["last_login_at"] = utcnow()
    # 🔧 Auto-sync subscription state from Stripe (heals webhook misses)
    try:
        u = await _sync_subscription_from_stripe(u) or u
    except Exception as e:
        logging.warning(f"Stripe auto-sync on login failed for {u.get('email')}: {e}")
    token = create_jwt(u["id"])
    return TokenResponse(access_token=token, user=user_to_public(u))


async def _sync_subscription_from_stripe(u: dict) -> Optional[dict]:
    """Re-read subscription state from Stripe and update DB if needed.

    SAFETY: This function will ONLY UPGRADE the user to is_subscribed=True if Stripe
    reports an active or trialing subscription. It will NOT downgrade an already-premium
    user (the webhook handles cancellations / payment failures).
    Returns the updated user dict, or None if no change.
    """
    if not STRIPE_API_KEY:
        return None
    customer_id = u.get("stripe_customer_id")
    email = (u.get("email") or "").lower()
    # If no customer_id yet, try to look the user up in Stripe by email
    if not customer_id and email:
        try:
            search = stripe.Customer.list(email=email, limit=1)
            data = getattr(search, "data", None) or []
            if data:
                customer_id = data[0].id
                await db.users.update_one({"id": u["id"]}, {"$set": {"stripe_customer_id": customer_id}})
        except Exception:
            pass
    if not customer_id:
        return None
    try:
        subs = stripe.Subscription.list(customer=customer_id, status="all", limit=5)
    except Exception as e:
        logging.warning(f"Stripe Subscription.list failed for {customer_id}: {e}")
        return None
    active_sub = None
    for s in (getattr(subs, "data", None) or []):
        if s.status in ("active", "trialing"):
            active_sub = s
            break
    if not active_sub:
        return None
    # Active subscription found → upgrade user if not already premium
    update: dict = {
        "is_subscribed": True,
        "subscription_status": active_sub.status,
        "stripe_subscription_id": active_sub.id,
        "cancel_at_period_end": bool(getattr(active_sub, "cancel_at_period_end", False)),
    }
    # Map Stripe price → plan code / tier (best-effort)
    try:
        items = getattr(active_sub, "items", None)
        items_data = getattr(items, "data", None) if items else None
        if items_data:
            price_id = items_data[0].price.id
            for code, cfg in PLANS.items():
                if cfg.get("price_id") == price_id:
                    update["subscription_plan"] = code
                    update["subscription_tier"] = cfg.get("tier")
                    break
    except Exception as e:
        logging.warning(f"Plan mapping failed: {e}")
    # Only set started_at if not already set
    if not u.get("subscription_started_at"):
        update["subscription_started_at"] = utcnow()
    await db.users.update_one({"id": u["id"]}, {"$set": update})
    u.update(update)
    logging.info(f"[StripeSync] Healed subscription for {email} (sub={active_sub.id}, status={active_sub.status})")
    return u


@api_router.get("/auth/me", response_model=UserPublic)
async def me(current: dict = Depends(get_current_user)):
    return user_to_public(current)


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


@api_router.post("/auth/change-password")
async def change_password(body: ChangePasswordRequest, current: dict = Depends(get_current_user)):
    """User changes their OWN password. Requires the current password for verification."""
    if not verify_password(body.current_password, current.get("password_hash", "")):
        raise HTTPException(status_code=401, detail="Mot de passe actuel incorrect")
    if len(body.new_password) < 6:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit faire au moins 6 caractères")
    if body.new_password == body.current_password:
        raise HTTPException(status_code=400, detail="Le nouveau mot de passe doit être différent de l'ancien")
    await db.users.update_one({"id": current["id"]}, {"$set": {
        "password_hash": hash_password(body.new_password),
        "password_changed_at": utcnow(),
    }})
    return {"ok": True, "message": "Mot de passe mis à jour avec succès"}


# --- RGPD: Export & Delete ---
@api_router.get("/me/export")
async def export_my_data(current: dict = Depends(get_current_user)):
    """RGPD Article 20 - Right to data portability.
    Export ALL personal data tied to the current user as JSON."""
    uid = current["id"]
    safe_user = {k: v for k, v in current.items() if k != "password_hash"}

    unlocks = await db.user_unlocks.find({"user_id": uid}, {"_id": 0}).to_list(1000)
    codes_created = await db.unlock_codes.find({"owner_user_id": uid}, {"_id": 0}).to_list(1000)
    hostings = await db.hosting_requests.find({"user_id": uid}, {"_id": 0}).to_list(1000)
    checkouts = await db.checkout_sessions.find({"user_id": uid}, {"_id": 0}).to_list(1000)
    contacts = await db.contact_requests.find({"email": current.get("email")}, {"_id": 0}).to_list(1000)

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "exported_for": current.get("email"),
        "legal_basis": "RGPD Article 20 - Droit à la portabilité",
        "data": {
            "account": safe_user,
            "video_unlocks": unlocks,
            "codes_created": codes_created,
            "hosting_requests": hostings,
            "payment_sessions": checkouts,
            "contact_requests": contacts,
        },
        "note": "Conservez ce fichier en lieu sûr. Pour toute question : contact@creativindustry.com",
    }


@api_router.delete("/me")
async def delete_my_account(current: dict = Depends(get_current_user)):
    """RGPD Article 17 - Right to erasure.
    Creates a moderation request (admin must approve within 30 days as per RGPD).
    Immediate cascade is preserved as fallback if NO admin moderation is desired.
    """
    uid = current["id"]
    email = current.get("email")

    if current.get("is_admin"):
        admin_count = await db.users.count_documents({"is_admin": True})
        if admin_count <= 1:
            raise HTTPException(
                status_code=400,
                detail="Impossible de supprimer le dernier compte admin. Créez d'abord un autre admin.",
            )

    # Check if user already has a pending request
    existing = await db.deletion_requests.find_one({"user_id": uid, "status": "pending"})
    if existing:
        return {
            "queued": True,
            "request_id": existing["id"],
            "status": "pending",
            "message": "Votre demande est déjà en cours de traitement.",
        }

    req = {
        "id": str(uuid.uuid4()),
        "user_id": uid,
        "email": email,
        "full_name": current.get("full_name"),
        "status": "pending",
        "requested_at": datetime.now(timezone.utc),
        "reason": None,
        "processed_at": None,
        "processed_by": None,
        "admin_note": None,
    }
    await db.deletion_requests.insert_one(req)

    # Notify user
    try:
        user_html = render_email(
            "Votre demande de suppression a bien été reçue",
            f"""<p>Bonjour {current.get('full_name') or ''},</p>
            <p>Nous avons bien reçu votre demande de suppression de compte conformément à l'article 17 du RGPD.</p>
            <p>Conformément à nos obligations légales, votre demande sera traitée sous <b>30 jours maximum</b>. Vous recevrez un email de confirmation dès que la suppression sera effective.</p>
            <p>Si vous souhaitez annuler cette demande, contactez-nous à <a href="mailto:contact@creativindustry.com" style="color:#D4AF37">contact@creativindustry.com</a>.</p>
            <p><b>Référence :</b> {req['id'][:8].upper()}</p>""",
        )
        if email:
            await send_email(email, "CINÉMARIÉS — Demande de suppression de compte reçue", user_html)

        # Notify admin
        admin_notify = os.environ.get("ADMIN_NOTIFY_EMAIL", "")
        if admin_notify:
            admin_html = render_email(
                "Nouvelle demande de suppression de compte",
                f"""<p>Un utilisateur a demandé la suppression de son compte (RGPD Art. 17).</p>
                <ul>
                  <li><b>Email :</b> {email}</li>
                  <li><b>Nom :</b> {current.get('full_name') or '—'}</li>
                  <li><b>ID utilisateur :</b> {uid}</li>
                  <li><b>Référence :</b> {req['id']}</li>
                  <li><b>Date de la demande :</b> {req['requested_at'].strftime('%d/%m/%Y %H:%M')} UTC</li>
                </ul>
                <p><b>Action requise sous 30 jours.</b></p>""",
                cta_label="Ouvrir l'admin",
                cta_url="https://cinemaries.fr/admin/deletion-requests",
            )
            await send_email(admin_notify, "[ADMIN] Demande de suppression — " + (email or "inconnu"), admin_html)
    except Exception as e:
        logging.error("Email error on deletion request: %s", e)

    return {
        "queued": True,
        "request_id": req["id"],
        "status": "pending",
        "message": "Votre demande a été enregistrée. Vous recevrez un email de confirmation sous 30 jours.",
    }


async def _execute_account_deletion(user_doc: dict) -> dict:
    """Internal helper that actually wipes a user's data (cascades).
    Called by admin endpoint after approval, OR directly if needed in scripts."""
    uid = user_doc["id"]
    email = user_doc.get("email")
    await db.user_unlocks.delete_many({"user_id": uid})
    await db.unlock_codes.delete_many({"owner_user_id": uid, "current_uses": 0})
    await db.unlock_codes.update_many(
        {"owner_user_id": uid},
        {"$set": {
            "owner_user_id": "deleted_user",
            "owner_email": None,
            "bound_device_ip": None,
            "bound_device_ua": None,
            "bound_device_label": None,
        }},
    )
    await db.hosting_requests.delete_many({"user_id": uid})
    await db.checkout_sessions.delete_many({"user_id": uid})
    if email:
        await db.contact_requests.delete_many({"email": email})
    await db.users.delete_one({"id": uid})
    return {"deleted": True, "email": email}


@api_router.get("/me/deletion-request")
async def my_deletion_request(current: dict = Depends(get_current_user)):
    """Show current user's pending deletion request status (if any)."""
    req = await db.deletion_requests.find_one(
        {"user_id": current["id"], "status": "pending"}, {"_id": 0}
    )
    return {"request": req}


# --- Admin: Moderate deletion requests ---
async def get_current_admin(current: dict = Depends(get_current_user)) -> dict:
    if not current.get("is_admin"):
        raise HTTPException(status_code=403, detail="Admin requis")
    return current


@api_router.get("/admin/deletion-requests")
async def admin_list_deletion_requests(status: str = "pending", admin: dict = Depends(get_current_admin)):
    """List all deletion requests (filterable by status: pending/approved/rejected/all)."""
    q = {} if status == "all" else {"status": status}
    items = await db.deletion_requests.find(q, {"_id": 0}).sort("requested_at", -1).to_list(500)
    return {"items": items, "count": len(items)}


@api_router.post("/admin/deletion-requests/{request_id}/approve")
async def admin_approve_deletion(request_id: str, admin: dict = Depends(get_current_admin)):
    req = await db.deletion_requests.find_one({"id": request_id})
    if not req:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    if req["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Demande déjà traitée (statut: {req['status']})")
    user = await db.users.find_one({"id": req["user_id"]})
    if not user:
        # User already deleted manually, mark as processed
        await db.deletion_requests.update_one(
            {"id": request_id},
            {"$set": {"status": "approved", "processed_at": datetime.now(timezone.utc), "processed_by": admin["id"], "admin_note": "Utilisateur déjà supprimé"}},
        )
        return {"approved": True, "already_deleted": True}

    # Safety: refuse to delete last admin
    if user.get("is_admin"):
        admin_count = await db.users.count_documents({"is_admin": True})
        if admin_count <= 1:
            raise HTTPException(status_code=400, detail="Impossible de supprimer le dernier admin.")

    await _execute_account_deletion(user)
    await db.deletion_requests.update_one(
        {"id": request_id},
        {"$set": {"status": "approved", "processed_at": datetime.now(timezone.utc), "processed_by": admin["id"]}},
    )

    # Confirmation email to deleted user
    try:
        email = req.get("email")
        if email:
            html = render_email(
                "Votre compte a été supprimé",
                f"""<p>Bonjour,</p>
                <p>Conformément à votre demande et à l'article 17 du RGPD, nous confirmons que toutes vos données personnelles ont été <b>définitivement supprimées</b> de nos systèmes.</p>
                <p>Cela inclut : votre compte, vos déblocages vidéo, vos codes générés, vos demandes d'hébergement, vos sessions de paiement.</p>
                <p>Si vous souhaitez à nouveau utiliser nos services, vous pourrez créer un nouveau compte à tout moment.</p>
                <p>Merci d'avoir fait confiance à CINÉMARIÉS.</p>""",
            )
            await send_email(email, "CINÉMARIÉS — Confirmation de suppression de compte", html)
    except Exception as e:
        logging.error("Email error after deletion approval: %s", e)
    return {"approved": True, "deleted": True}


@api_router.post("/admin/deletion-requests/{request_id}/reject")
async def admin_reject_deletion(request_id: str, body: dict, admin: dict = Depends(get_current_admin)):
    reason = (body or {}).get("reason", "").strip()
    if not reason:
        raise HTTPException(status_code=400, detail="Un motif de rejet est obligatoire.")
    req = await db.deletion_requests.find_one({"id": request_id})
    if not req:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    if req["status"] != "pending":
        raise HTTPException(status_code=400, detail=f"Demande déjà traitée (statut: {req['status']})")
    await db.deletion_requests.update_one(
        {"id": request_id},
        {"$set": {
            "status": "rejected",
            "processed_at": datetime.now(timezone.utc),
            "processed_by": admin["id"],
            "admin_note": reason,
        }},
    )
    # Notify user
    try:
        email = req.get("email")
        if email:
            html = render_email(
                "Votre demande de suppression a été rejetée",
                f"""<p>Bonjour,</p>
                <p>Votre demande de suppression de compte a été examinée par notre équipe et n'a pas pu être traitée pour le motif suivant :</p>
                <blockquote style="border-left:3px solid #D4AF37;padding-left:14px;margin:16px 0;color:#E5E2D6">{reason}</blockquote>
                <p>Si vous souhaitez en discuter ou contester cette décision, contactez-nous à <a href="mailto:contact@creativindustry.com" style="color:#D4AF37">contact@creativindustry.com</a>.</p>""",
            )
            await send_email(email, "CINÉMARIÉS — Décision sur votre demande de suppression", html)
    except Exception as e:
        logging.error("Email error after deletion rejection: %s", e)
    return {"rejected": True, "reason": reason}



# --- FTP / SFTP IMPORT (admin) ---
# Permet d'uploader d'énormes fichiers via FileZilla/WinSCP vers /uploads/ftp_drop/
# puis de les importer dans une vidéo sans repasser par le navigateur.
import shutil as _shutil_mod

FTP_DROP_DIR = UPLOAD_DIR / "ftp_drop"
FTP_DROP_DIR.mkdir(parents=True, exist_ok=True)


def _human_size(n: float) -> str:
    for unit in ["B", "KB", "MB", "GB", "TB"]:
        if n < 1024:
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} PB"


@api_router.get("/admin/ftp-files")
async def list_ftp_files(admin: dict = Depends(get_current_admin)):
    """Liste les fichiers déposés via FTP/SFTP dans uploads/ftp_drop/."""
    items = []
    try:
        for f in FTP_DROP_DIR.iterdir():
            if f.is_file() and not f.name.startswith("."):
                stat = f.stat()
                items.append({
                    "name": f.name,
                    "size": stat.st_size,
                    "size_human": _human_size(float(stat.st_size)),
                    "modified": datetime.fromtimestamp(stat.st_mtime, tz=timezone.utc).isoformat(),
                    "ext": f.suffix.lower().lstrip("."),
                })
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur lecture dossier FTP: {e}")
    items.sort(key=lambda x: x["modified"], reverse=True)
    return {"items": items, "count": len(items), "drop_path": str(FTP_DROP_DIR)}


class FtpImportRequest(BaseModel):
    filename: str
    target: str  # "poster" | "hero" | "trailer" | "full"
    video_id: Optional[str] = None


@api_router.post("/admin/ftp-files/import")
async def import_ftp_file(body: FtpImportRequest, admin: dict = Depends(get_current_admin)):
    """Déplace un fichier de ftp_drop/ vers uploads/ avec un nom UUID,
    puis met à jour la vidéo si video_id est fourni."""
    if "/" in body.filename or "\\" in body.filename or ".." in body.filename:
        raise HTTPException(status_code=400, detail="Nom de fichier invalide")
    src = FTP_DROP_DIR / body.filename
    if not src.exists() or not src.is_file():
        raise HTTPException(status_code=404, detail=f"Fichier '{body.filename}' introuvable dans ftp_drop/")
    if body.target not in ("poster", "hero", "trailer", "full"):
        raise HTTPException(status_code=400, detail="target doit être: poster, hero, trailer ou full")

    ext = src.suffix.lower()
    new_name = f"{uuid.uuid4().hex}{ext}"
    dst = UPLOAD_DIR / new_name
    try:
        _shutil_mod.move(str(src), str(dst))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erreur déplacement: {e}")

    public_url = f"{APP_PUBLIC_URL}/api/uploads/{new_name}" if APP_PUBLIC_URL else f"/api/uploads/{new_name}"

    if body.video_id:
        field_map = {
            "poster": "poster_url",
            "hero": "hero_url",
            "trailer": "trailer_url",
            "full": "full_url",
        }
        update_field = field_map[body.target]
        result = await db.videos.update_one(
            {"id": body.video_id},
            {"$set": {update_field: public_url, "updated_at": datetime.now(timezone.utc)}},
        )
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail=f"Vidéo {body.video_id} introuvable")

    return {
        "imported": True,
        "url": public_url,
        "filename": new_name,
        "size": dst.stat().st_size,
        "target": body.target,
        "video_updated": bool(body.video_id),
    }


@api_router.delete("/admin/ftp-files/{filename}")
async def delete_ftp_file(filename: str, admin: dict = Depends(get_current_admin)):
    """Supprime un fichier non utilisé du dossier ftp_drop/."""
    if "/" in filename or "\\" in filename or ".." in filename:
        raise HTTPException(status_code=400, detail="Nom de fichier invalide")
    f = FTP_DROP_DIR / filename
    if not f.exists():
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    f.unlink()
    return {"deleted": True, "filename": filename}

# --- END FTP IMPORT ---


# --- VIDEOS ---
@api_router.get("/videos/public")
async def list_public_videos():
    """Public catalog: posters + trailers visible without code"""
    videos = await db.videos.find({}, {"_id": 0}).to_list(500)
    result = {
        "featured": [],
        "rows": {},
    }
    for v in videos:
        pub = video_to_public(v, include_full=False)
        if v.get("is_featured"):
            result["featured"].append(pub)
        result["rows"].setdefault(v["category"], []).append(pub)
    # sort featured top-france first
    result["featured"].sort(key=lambda x: (not x["is_top_france"], x["title"]))
    return result


@api_router.get("/videos/showcase")
async def list_showcase_videos(current: Optional[dict] = Depends(get_optional_user)):
    """Public showcase / demos — visible to all, playable by any logged-in user.

    Returns Netflix-style rows grouped by category + a featured shelf.
    full_url is included only when the user is authenticated (to play / cast).
    """
    include_full = bool(current)
    videos = await db.videos.find({"is_showcase": True}, {"_id": 0}).sort("created_at", -1).to_list(500)
    featured: list[dict] = []
    rows: dict[str, list[dict]] = {}
    for v in videos:
        pub = video_to_public(v, include_full=include_full)
        if v.get("is_featured"):
            featured.append(pub)
        rows.setdefault(v.get("category") or "À l'affiche", []).append(pub)
    # Stable category order
    preferred_order = ["À l'affiche", "Cérémonies", "Soirées", "Best Of"]
    ordered_rows = []
    for cat in preferred_order:
        if cat in rows:
            ordered_rows.append({"category": cat, "videos": rows.pop(cat)})
    for cat, items in rows.items():
        ordered_rows.append({"category": cat, "videos": items})
    return {
        "is_authenticated": bool(current),
        "featured": featured,
        "rows": ordered_rows,
        "total": len(videos),
    }


# --- WEDDINGS (grouped by client_id) ---
def _group_by_wedding(videos: list[dict], metas: Optional[dict[str, dict]] = None) -> dict:
    """Group videos by wedding (client_id).

    `metas` is an optional dict {client_id: wedding_meta_doc} used to OVERRIDE
    the wedding-level poster/hero with admin-defined values (set via
    POST /admin/weddings/{client_id}/cover). Falls back to the first/featured
    video's poster when no meta is defined.
    """
    metas = metas or {}
    by_client: dict[str, dict] = {}
    for v in videos:
        cid = v.get("client_id") or slugify(v.get("title", ""))
        name = v.get("client_name") or v.get("title", "")
        if cid not in by_client:
            by_client[cid] = {
                "client_id": cid,
                "client_name": name,
                "poster_url": v.get("poster_url", ""),
                "hero_url": v.get("hero_url") or v.get("poster_url", ""),
                "description": v.get("description", ""),
                "is_featured": False,
                "is_top_france": False,
                "video_count": 0,
                "total_minutes": 0,
                "videos": [],
            }
        w = by_client[cid]
        w["video_count"] += 1
        w["total_minutes"] += int(v.get("duration_minutes", 0) or 0)
        if v.get("is_featured"):
            w["is_featured"] = True
            w["poster_url"] = v.get("poster_url", w["poster_url"])
            w["hero_url"] = v.get("hero_url") or v.get("poster_url", w["hero_url"])
            w["description"] = v.get("description", w["description"])
        if v.get("is_top_france"):
            w["is_top_france"] = True
    # Apply wedding-level admin overrides (highest priority)
    for cid, w in by_client.items():
        meta = metas.get(cid)
        if meta:
            if meta.get("poster_url"):
                w["poster_url"] = meta["poster_url"]
            if meta.get("hero_url"):
                w["hero_url"] = meta["hero_url"]
            if meta.get("description"):
                w["description"] = meta["description"]
    return by_client


async def _fetch_wedding_metas() -> dict[str, dict]:
    """Fetch all wedding metadata as dict keyed by client_id."""
    docs = await db.wedding_meta.find({}, {"_id": 0}).to_list(1000)
    return {d["client_id"]: d for d in docs if d.get("client_id")}


@api_router.get("/weddings/public")
async def list_public_weddings():
    """List of weddings (grouped from videos). Public — no full URLs."""
    videos = await db.videos.find({}, {"_id": 0}).to_list(500)
    metas = await _fetch_wedding_metas()
    grouped = _group_by_wedding(videos, metas)
    weddings = list(grouped.values())
    weddings.sort(key=lambda w: (not w["is_top_france"], not w["is_featured"], w["client_name"]))
    return {
        "featured": [w for w in weddings if w["is_featured"]],
        "weddings": weddings,
    }


@api_router.get("/weddings/{client_id}")
async def get_wedding(client_id: str, code: Optional[str] = None, current: Optional[dict] = Depends(get_optional_user)):
    videos = await db.videos.find({}, {"_id": 0}).to_list(500)
    # filter to this client
    filtered = [v for v in videos if (v.get("client_id") or slugify(v.get("title", ""))) == client_id]
    if not filtered:
        raise HTTPException(status_code=404, detail="Mariage introuvable")
    # check unlock status
    unlocked = False
    if current:
        if current.get("is_admin") or current.get("is_subscribed"):
            unlocked = True
        else:
            u = await db.user_unlocks.find_one({"user_id": current["id"], "client_id": client_id})
            unlocked = bool(u)
    # anonymous unlock via code query param
    if not unlocked and code:
        clean = code.strip().upper()
        rec = await db.unlock_codes.find_one({"code": clean, "is_active": True}, {"_id": 0})
        if rec:
            rec_cid = rec.get("client_id")
            if not rec_cid and rec.get("video_id"):
                vv = await db.videos.find_one({"id": rec["video_id"]}, {"_id": 0})
                if vv:
                    rec_cid = vv.get("client_id") or slugify(vv.get("title", ""))
            if rec_cid == client_id:
                if not (rec.get("expires_at") and rec["expires_at"] < utcnow()):
                    if not (rec.get("max_uses") and rec.get("current_uses", 0) >= rec["max_uses"]):
                        unlocked = True
    grouped = _group_by_wedding(filtered, await _fetch_wedding_metas())
    wedding = next(iter(grouped.values()))
    wedding["unlocked"] = unlocked
    # Owner flag — premium clients see "Invite friends" button on their own wedding
    wedding["is_my_wedding"] = bool(current and current.get("client_id") == client_id)
    wedding["videos"] = [video_to_public(v, include_full=unlocked) for v in filtered]
    # sort videos by category preferring chronological wedding day order
    cat_order = {"À l'affiche": 0, "Cérémonies": 1, "Soirées": 2, "Best Of": 3}
    wedding["videos"].sort(key=lambda x: cat_order.get(x.get("category", ""), 99))
    return wedding


@api_router.post("/weddings/unlock")
async def unlock_wedding(body: UnlockRequest, request: Request, current: Optional[dict] = Depends(get_optional_user)):
    """Enter a code to unlock an entire wedding. Works anonymously (no login required).
    Each code can be activated on UP TO MAX_DEVICES_PER_CODE devices (default 3).
    The same device can re-unlock with the code as many times as needed.

    🔑 MASTER TEST CODE (admin-only):
      If the entered code equals env MASTER_TEST_CODE (default 'STUDIO2026'):
        • Bypasses device limit
        • Unlocks the wedding specified by body.client_id
        • If body.client_id is missing, returns the list of available weddings (HTTP 422)
        • Only usable by an authenticated ADMIN account
    """
    code = body.code.strip().upper()

    # === MASTER TEST CODE PATH ===
    master_code = (os.getenv("MASTER_TEST_CODE", "STUDIO2026") or "").strip().upper()
    if master_code and code == master_code:
        if not current or not current.get("is_admin"):
            raise HTTPException(status_code=403, detail="Code maître réservé à l'administration")
        target_client_id = (body.client_id or "").strip()
        if not target_client_id:
            # Help admin: return list of available client_ids
            all_v = await db.videos.find({}, {"_id": 0, "client_id": 1, "title": 1, "client_name": 1}).to_list(500)
            seen: dict[str, str] = {}
            for v in all_v:
                cid = v.get("client_id") or slugify(v.get("title", ""))
                if cid and cid not in seen:
                    seen[cid] = v.get("client_name") or v.get("title") or cid
            raise HTTPException(
                status_code=422,
                detail={
                    "message": "Code maître reconnu — précisez le mariage à débloquer dans 'client_id'.",
                    "available_weddings": [{"client_id": k, "name": v} for k, v in seen.items()],
                },
            )
        # Find all videos for that wedding
        all_videos = await db.videos.find({}, {"_id": 0}).to_list(500)
        wedding_videos = [v for v in all_videos if (v.get("client_id") or slugify(v.get("title", ""))) == target_client_id]
        if not wedding_videos:
            raise HTTPException(status_code=404, detail=f"Mariage introuvable: {target_client_id}")
        # Record unlock for the admin user
        await db.user_unlocks.update_one(
            {"user_id": current["id"], "client_id": target_client_id},
            {"$set": {
                "user_id": current["id"],
                "client_id": target_client_id,
                "code": "__MASTER__",
                "unlocked_at": utcnow(),
            }},
            upsert=True,
        )
        for v in wedding_videos:
            await db.user_unlocks.update_one(
                {"user_id": current["id"], "video_id": v["id"]},
                {"$set": {"user_id": current["id"], "video_id": v["id"], "code": "__MASTER__", "unlocked_at": utcnow()}},
                upsert=True,
            )
        return {
            "ok": True,
            "master": True,
            "client_id": target_client_id,
            "videos": [video_to_public(v, include_full=True) for v in wedding_videos],
        }

    rec = await db.unlock_codes.find_one({"code": code, "is_active": True}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Code invalide")
    if rec.get("expires_at") and rec["expires_at"] < utcnow():
        raise HTTPException(status_code=410, detail="Code expiré")

    # DEVICE BINDING: 1 code = up to MAX_DEVICES_PER_CODE devices.
    device_id = (body.device_id or "").strip()

    # Build the list of currently bound devices.
    # Backward compat: if a code used the old single-device schema, promote it to the new list.
    bound_devices: List[dict] = list(rec.get("bound_devices") or [])
    legacy_id = rec.get("bound_device_id")
    if legacy_id and not any((d.get("device_id") == legacy_id) for d in bound_devices):
        bound_devices.insert(0, {
            "device_id": legacy_id,
            "label": rec.get("bound_device_label") or "Appareil",
            "ip": rec.get("bound_device_ip"),
            "ua": rec.get("bound_device_ua"),
            "bound_at": rec.get("bound_at"),
            "last_seen_at": rec.get("last_seen_at") or rec.get("bound_at"),
        })

    is_known_device = bool(device_id) and any((d.get("device_id") == device_id) for d in bound_devices)

    if not is_known_device:
        # Either it's a fresh device or no device_id provided.
        if bound_devices and not device_id:
            # Code already used by other devices but caller did not identify themselves
            raise HTTPException(
                status_code=403,
                detail=f"Ce code est déjà utilisé sur {len(bound_devices)} appareil(s). Veuillez utiliser l'un de ces appareils."
            )
        if len(bound_devices) >= MAX_DEVICES_PER_CODE:
            raise HTTPException(
                status_code=403,
                detail=(
                    f"Limite de {MAX_DEVICES_PER_CODE} appareils atteinte pour ce code. "
                    "Passez à l'offre Illimité ou contactez les mariés pour qu'ils génèrent un nouveau code."
                ),
            )
        # Respect legacy max_uses if explicitly set above MAX_DEVICES_PER_CODE
        if rec.get("max_uses") and rec.get("current_uses", 0) >= rec["max_uses"]:
            # If max_uses == 1 (legacy "1 device" codes from earlier rollout), upgrade silently to 3
            if rec["max_uses"] >= MAX_DEVICES_PER_CODE:
                raise HTTPException(status_code=429, detail="Code épuisé")

    # Determine client_id from the code (new) or derive from video_id (backward compat)
    client_id = rec.get("client_id")
    if not client_id and rec.get("video_id"):
        v = await db.videos.find_one({"id": rec["video_id"]}, {"_id": 0})
        if v:
            client_id = v.get("client_id") or slugify(v.get("title", ""))
    if not client_id:
        raise HTTPException(status_code=404, detail="Mariage introuvable")

    # all videos in that wedding
    all_videos = await db.videos.find({}, {"_id": 0}).to_list(500)
    wedding_videos = [v for v in all_videos if (v.get("client_id") or slugify(v.get("title", ""))) == client_id]
    if not wedding_videos:
        raise HTTPException(status_code=404, detail="Aucune vidéo pour ce mariage")

    # record wedding-level unlock if user is logged in
    auto_assigned = False
    if current:
        await db.user_unlocks.update_one(
            {"user_id": current["id"], "client_id": client_id},
            {"$set": {
                "user_id": current["id"],
                "client_id": client_id,
                "code": code,
                "unlocked_at": utcnow(),
            }},
            upsert=True,
        )
        for v in wedding_videos:
            await db.user_unlocks.update_one(
                {"user_id": current["id"], "video_id": v["id"]},
                {"$set": {
                    "user_id": current["id"],
                    "video_id": v["id"],
                    "client_id": client_id,
                    "code": code,
                    "unlocked_at": utcnow(),
                }},
                upsert=True,
            )

        # AUTO-ASSIGN ownership: if the logged-in user is a paying subscriber AND
        # does not yet own a wedding, claim this wedding as their own.
        # Rule: first-come, first-served on subscribers — once a subscriber owns the
        # wedding, future subscribers entering the same code just unlock for viewing
        # but do NOT take ownership.
        if (current.get("is_subscribed") or current.get("is_admin")) and not current.get("client_id"):
            existing_owner = await db.users.find_one(
                {"client_id": client_id, "is_subscribed": True},
                {"_id": 0, "id": 1, "email": 1},
            )
            if not existing_owner or existing_owner.get("id") == current["id"]:
                await db.users.update_one(
                    {"id": current["id"]},
                    {"$set": {"client_id": client_id}},
                )
                auto_assigned = True
                logging.info(
                    f"[auto-assign] user {current.get('email')} → wedding {client_id} (via code {code})"
                )

    # Update bound_devices array
    now = utcnow()
    ip = (request.client.host if request.client else "") or ""
    ua = (request.headers.get("user-agent") or "")[:300]

    if device_id:
        if is_known_device:
            # Same device re-unlocking — just refresh last_seen
            for d in bound_devices:
                if d.get("device_id") == device_id:
                    d["last_seen_at"] = now
                    if body.device_label:
                        d["label"] = body.device_label
                    break
        else:
            # New device joining (we already checked we are under the limit)
            bound_devices.append({
                "device_id": device_id,
                "label": (body.device_label or "Appareil")[:60],
                "ip": ip,
                "ua": ua,
                "bound_at": now,
                "last_seen_at": now,
            })

        # Persist the updated devices array. Also keep the legacy single fields populated
        # with the FIRST device for backward compat with admin UIs that don't yet read the array.
        first = bound_devices[0]
        await db.unlock_codes.update_one(
            {"code": code},
            {
                "$set": {
                    "bound_devices": bound_devices,
                    "bound_device_id": first.get("device_id"),
                    "bound_device_label": first.get("label"),
                    "bound_device_ip": first.get("ip"),
                    "bound_device_ua": first.get("ua"),
                    "bound_at": first.get("bound_at"),
                    "last_seen_at": now,
                },
                "$inc": {"current_uses": 0 if is_known_device else 1},
            },
        )
    else:
        # No device id provided (legacy caller) — bump usage count, do not bind
        await db.unlock_codes.update_one({"code": code}, {"$inc": {"current_uses": 1}})

    wedding_name = wedding_videos[0].get("client_name") or wedding_videos[0].get("title")
    # also return the full videos so client can play immediately
    full_videos = [video_to_public(v, include_full=True) for v in wedding_videos]
    return {
        "ok": True,
        "client_id": client_id,
        "client_name": wedding_name,
        "video_count": len(wedding_videos),
        "devices_used": len(bound_devices) if device_id else None,
        "devices_max": MAX_DEVICES_PER_CODE,
        "auto_assigned": auto_assigned,
        "videos": full_videos,
    }


# --- CLIENT SELF-SERVICE CODES (premium owners can generate codes for their own wedding) ---
def code_to_public(c: dict) -> dict:
    expired = bool(c.get("expires_at") and c["expires_at"] < utcnow())
    # Backward-compat: build devices list from legacy single-device fields if needed.
    devices_raw = list(c.get("bound_devices") or [])
    if not devices_raw and c.get("bound_device_id"):
        devices_raw = [{
            "device_id": c.get("bound_device_id"),
            "label": c.get("bound_device_label") or "Appareil",
            "ip": c.get("bound_device_ip"),
            "ua": c.get("bound_device_ua"),
            "bound_at": c.get("bound_at"),
            "last_seen_at": c.get("last_seen_at") or c.get("bound_at"),
        }]
    devices_out = [{
        "device_id": d.get("device_id"),
        "label": d.get("label") or "Appareil",
        "bound_at": d.get("bound_at").isoformat() if d.get("bound_at") else None,
        "last_seen_at": d.get("last_seen_at").isoformat() if d.get("last_seen_at") else None,
    } for d in devices_raw]
    return {
        "code": c["code"],
        "client_id": c.get("client_id"),
        "label": c.get("label"),
        "is_active": c.get("is_active", True) and not expired,
        "expired": expired,
        "current_uses": c.get("current_uses", 0),
        "max_uses": c.get("max_uses"),
        # Legacy single-device fields (first device) — kept for backward compat
        "bound_device_id": (devices_out[0]["device_id"] if devices_out else None),
        "bound_device_label": (devices_out[0]["label"] if devices_out else None),
        "bound_at": (devices_out[0]["bound_at"] if devices_out else None),
        # New multi-device fields
        "devices": devices_out,
        "devices_count": len(devices_out),
        "devices_max": MAX_DEVICES_PER_CODE,
        "created_at": c.get("created_at").isoformat() if c.get("created_at") else None,
    }


@api_router.get("/client/codes")
async def client_list_codes(current: dict = Depends(get_current_user)):
    """List codes generated by the current client for their assigned wedding."""
    if not current.get("client_id"):
        raise HTTPException(status_code=403, detail="Aucun mariage assigné à votre compte. Contactez l'administrateur.")
    if not (current.get("is_subscribed") or current.get("is_admin")):
        raise HTTPException(status_code=402, detail="Abonnement Premium requis pour générer des codes.")
    codes = await db.unlock_codes.find(
        {"client_id": current["client_id"], "owner_user_id": current["id"]},
        {"_id": 0}
    ).sort("created_at", -1).to_list(200)
    tier = current.get("subscription_tier") or "basic"
    limit = None if tier == "unlimited" or current.get("is_admin") else BASIC_MAX_CODES
    active_count = sum(1 for c in codes if c.get("is_active", True))
    return {
        "codes": [code_to_public(c) for c in codes],
        "tier": tier,
        "limit": limit,
        "active_count": active_count,
        "can_create": (limit is None) or (active_count < limit),
    }


@api_router.post("/client/codes")
async def client_create_code(body: ClientCodeCreate, current: dict = Depends(get_current_user)):
    """Generate a new code (1 code = 1 device). Limit depends on subscription tier."""
    if not current.get("client_id"):
        raise HTTPException(status_code=403, detail="Aucun mariage assigné. Contactez l'administrateur.")
    if not (current.get("is_subscribed") or current.get("is_admin")):
        raise HTTPException(status_code=402, detail="Abonnement Premium requis.")

    tier = current.get("subscription_tier") or "basic"
    if tier != "unlimited" and not current.get("is_admin"):
        # Count active codes owned by this user for this wedding
        active = await db.unlock_codes.count_documents({
            "owner_user_id": current["id"],
            "client_id": current["client_id"],
            "is_active": True,
        })
        if active >= BASIC_MAX_CODES:
            raise HTTPException(
                status_code=403,
                detail=f"Limite atteinte ({BASIC_MAX_CODES} codes max). Passez à l'offre Illimité (2,30€/mois) pour générer des codes sans limite.",
            )

    # Make sure the wedding actually exists
    all_v = await db.videos.find({}, {"_id": 0}).to_list(500)
    matching = [v for v in all_v if (v.get("client_id") or slugify(v.get("title", ""))) == current["client_id"]]
    if not matching:
        raise HTTPException(status_code=404, detail="Mariage introuvable")

    code = gen_unlock_code(8)
    await db.unlock_codes.insert_one({
        "code": code,
        "client_id": current["client_id"],
        "video_id": None,
        "label": (body.label or "").strip() or None,
        "owner_user_id": current["id"],
        "owner_email": current.get("email"),
        "source": "client",
        "is_active": True,
        # Device-based limit (MAX_DEVICES_PER_CODE); max_uses kept null for new codes.
        "max_uses": None,
        "current_uses": 0,
        "expires_at": None,
        "bound_devices": [],
        "bound_device_id": None,
        "created_at": utcnow(),
    })
    return {"ok": True, "code": code, "client_id": current["client_id"]}


@api_router.delete("/client/codes/{code}/devices/{device_id}")
async def client_revoke_device(code: str, device_id: str, current: dict = Depends(get_current_user)):
    """Revoke ONE specific device from a code so the freed slot can be re-used by a new device."""
    code = code.strip().upper()
    rec = await db.unlock_codes.find_one({"code": code}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Code introuvable")
    if rec.get("owner_user_id") != current["id"] and not current.get("is_admin"):
        raise HTTPException(status_code=403, detail="Vous n'êtes pas le propriétaire de ce code")

    devices = list(rec.get("bound_devices") or [])
    legacy_id = rec.get("bound_device_id")
    if legacy_id and not any(d.get("device_id") == legacy_id for d in devices):
        devices.insert(0, {
            "device_id": legacy_id,
            "label": rec.get("bound_device_label") or "Appareil",
            "ip": rec.get("bound_device_ip"),
            "ua": rec.get("bound_device_ua"),
            "bound_at": rec.get("bound_at"),
            "last_seen_at": rec.get("last_seen_at") or rec.get("bound_at"),
        })

    new_devices = [d for d in devices if d.get("device_id") != device_id]
    if len(new_devices) == len(devices):
        raise HTTPException(status_code=404, detail="Appareil introuvable pour ce code")

    first = new_devices[0] if new_devices else None
    await db.unlock_codes.update_one(
        {"code": code},
        {"$set": {
            "bound_devices": new_devices,
            "bound_device_id": first.get("device_id") if first else None,
            "bound_device_label": first.get("label") if first else None,
            "bound_device_ip": first.get("ip") if first else None,
            "bound_device_ua": first.get("ua") if first else None,
            "bound_at": first.get("bound_at") if first else None,
        }},
    )
    return {"ok": True, "devices_count": len(new_devices), "devices_max": MAX_DEVICES_PER_CODE}


@api_router.delete("/client/codes/{code}")
async def client_revoke_code(code: str, current: dict = Depends(get_current_user)):
    code = code.strip().upper()
    rec = await db.unlock_codes.find_one({"code": code}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Code introuvable")
    if rec.get("owner_user_id") != current["id"] and not current.get("is_admin"):
        raise HTTPException(status_code=403, detail="Vous n'êtes pas le propriétaire de ce code")
    await db.unlock_codes.update_one({"code": code}, {"$set": {"is_active": False}})
    return {"ok": True}


# --- HOSTING REQUESTS (one-time 90€ fee to host a wedding) ---
def hosting_to_public(h: dict) -> dict:
    upload_token = h.get("upload_token")
    return {
        "id": h["id"],
        "user_id": h.get("user_id"),
        "user_email": h.get("user_email"),
        "couple_name": h.get("couple_name"),
        "wedding_date": h.get("wedding_date"),
        "location": h.get("location"),
        "contact_email": h.get("contact_email"),
        "contact_phone": h.get("contact_phone"),
        "description": h.get("description"),
        "drive_link": h.get("drive_link"),
        "notes": h.get("notes"),
        "delivery_method": h.get("delivery_method", "external_link"),
        "upload_token": upload_token,
        "upload_url": f"{APP_PUBLIC_URL}/u/{upload_token}" if upload_token else None,
        "uploaded_files": h.get("uploaded_files", []),
        "status": h.get("status", "pending_payment"),
        "amount": h.get("amount", HOSTING_FEE_AMOUNT),
        "currency": h.get("currency", "eur"),
        "client_id": h.get("client_id"),
        "checkout_url": h.get("checkout_url"),
        "created_at": h.get("created_at").isoformat() if h.get("created_at") else None,
        "paid_at": h.get("paid_at").isoformat() if h.get("paid_at") else None,
        "published_at": h.get("published_at").isoformat() if h.get("published_at") else None,
    }


@api_router.post("/hosting/requests")
async def create_hosting_request(body: HostingRequestCreate, current: dict = Depends(get_current_user)):
    """Step 1: User fills the form. We create a 'pending_payment' record and return a Stripe Checkout URL."""
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=503, detail="Le service de paiement n'est pas encore configuré.")
    rid = str(uuid.uuid4())
    delivery_method = (body.delivery_method or "upload_link").lower()
    if delivery_method not in ("upload_link", "external_link", "usb_office"):
        delivery_method = "upload_link"
    upload_token = secrets.token_urlsafe(16) if delivery_method == "upload_link" else None
    doc = {
        "id": rid,
        "user_id": current["id"],
        "user_email": current.get("email"),
        "couple_name": body.couple_name.strip(),
        "wedding_date": body.wedding_date,
        "location": (body.location or "").strip(),
        "contact_email": body.contact_email,
        "contact_phone": (body.contact_phone or "").strip(),
        "description": (body.description or "").strip(),
        "drive_link": (body.drive_link or "").strip(),
        "notes": (body.notes or "").strip(),
        "delivery_method": delivery_method,
        "upload_token": upload_token,
        "uploaded_files": [],
        "status": "pending_payment",
        "amount": HOSTING_FEE_AMOUNT,
        "currency": STRIPE_PRICE_CURRENCY,
        "client_id": None,
        "stripe_session_id": None,
        "checkout_url": None,
        "created_at": utcnow(),
        "paid_at": None,
        "published_at": None,
    }

    # Re-use/create Stripe customer
    customer_id = current.get("stripe_customer_id")
    if not customer_id:
        try:
            customer = stripe.Customer.create(email=current["email"], name=current.get("full_name") or "")
            customer_id = customer.id
            await db.users.update_one({"id": current["id"]}, {"$set": {"stripe_customer_id": customer_id}})
        except stripe.error.StripeError as e:  # type: ignore[attr-defined]
            raise HTTPException(status_code=502, detail=f"Stripe error: {str(e)}")

    try:
        success_url = f"{APP_PUBLIC_URL}/host/success?session_id={{CHECKOUT_SESSION_ID}}&request_id={rid}"
        cancel_url = f"{APP_PUBLIC_URL}/host?status=cancel&request_id={rid}"
        session = stripe.checkout.Session.create(
            mode="payment",
            customer=customer_id,
            line_items=[{
                "price_data": {
                    "currency": STRIPE_PRICE_CURRENCY,
                    "product_data": {
                        "name": f"CINÉMARIÉS — Hébergement à vie ({body.couple_name})",
                        "description": "Frais unique d'hébergement (paiement unique, à vie).",
                    },
                    "unit_amount": HOSTING_FEE_AMOUNT,
                },
                "quantity": 1,
            }],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"kind": "hosting_fee", "request_id": rid, "user_id": current["id"]},
        )
        doc["stripe_session_id"] = session.id
        doc["checkout_url"] = session.url
        await db.hosting_requests.insert_one(doc)
        return {"id": rid, "checkout_url": session.url, "amount": HOSTING_FEE_AMOUNT, "currency": STRIPE_PRICE_CURRENCY}
    except stripe.error.StripeError as e:  # type: ignore[attr-defined]
        raise HTTPException(status_code=502, detail=f"Stripe error: {str(e)}")


@api_router.get("/hosting/requests/me")
async def my_hosting_requests(current: dict = Depends(get_current_user)):
    rs = await db.hosting_requests.find({"user_id": current["id"]}, {"_id": 0}).sort("created_at", -1).to_list(100)
    return {"requests": [hosting_to_public(r) for r in rs]}


@api_router.get("/hosting/requests/{request_id}/status")
async def hosting_request_status(request_id: str, session_id: Optional[str] = None, current: dict = Depends(get_current_user)):
    r = await db.hosting_requests.find_one({"id": request_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    if r["user_id"] != current["id"] and not current.get("is_admin"):
        raise HTTPException(status_code=403, detail="Accès refusé")
    if session_id and r.get("status") == "pending_payment" and STRIPE_API_KEY:
        try:
            s = stripe.checkout.Session.retrieve(session_id)
            if s.get("payment_status") == "paid":
                await db.hosting_requests.update_one(
                    {"id": request_id},
                    {"$set": {
                        "status": "paid",
                        "paid_at": utcnow(),
                        "stripe_payment_intent_id": s.get("payment_intent"),
                    }},
                )
                r["status"] = "paid"
        except Exception as e:
            logging.warning(f"Stripe retrieve error (hosting): {e}")
    r = await db.hosting_requests.find_one({"id": request_id}, {"_id": 0})
    return hosting_to_public(r) if r else {}


# --- PUBLIC UPLOAD via secure token (used by the videographer / couple to send raw videos) ---
@api_router.get("/hosting/upload/{token}")
async def hosting_upload_info(token: str):
    """Public endpoint: returns info about an upload session (no auth, token-protected)."""
    r = await db.hosting_requests.find_one({"upload_token": token}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Lien invalide ou expiré.")
    # Only allow uploads if payment is confirmed
    if r.get("status") == "pending_payment":
        return {
            "ok": False,
            "couple_name": r.get("couple_name"),
            "status": r.get("status"),
            "message": "Cette demande est en attente de paiement. L'upload sera activé une fois le paiement reçu.",
            "uploaded_files": r.get("uploaded_files", []),
        }
    return {
        "ok": True,
        "couple_name": r.get("couple_name"),
        "status": r.get("status"),
        "uploaded_files": r.get("uploaded_files", []),
    }


@api_router.post("/hosting/upload/{token}/file")
async def hosting_upload_file(token: str, file: UploadFile = File(...)):
    """Public endpoint: accepts a single file upload for a specific hosting request token.
    For very large files (>50MB), prefer /hosting/upload/{token}/chunk to avoid proxy timeouts."""
    r = await db.hosting_requests.find_one({"upload_token": token}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Lien invalide.")
    if r.get("status") == "pending_payment":
        raise HTTPException(status_code=402, detail="Paiement requis avant l'envoi des fichiers.")
    if r.get("status") in ("rejected",):
        raise HTTPException(status_code=400, detail="Cette demande a été rejetée.")

    hosting_dir = UPLOAD_DIR / f"hosting_{r['id']}"
    hosting_dir.mkdir(exist_ok=True)

    orig_name = (file.filename or "fichier").replace("/", "_").replace("\\", "_")
    ext = ""
    if "." in orig_name:
        ext = "." + orig_name.rsplit(".", 1)[-1].lower()[:10]
    safe_id = secrets.token_hex(8)
    saved_name = f"{safe_id}{ext}"
    dest = hosting_dir / saved_name

    size = 0
    with open(dest, "wb") as f_out:
        while True:
            chunk = await file.read(2 * 1024 * 1024)
            if not chunk:
                break
            f_out.write(chunk)
            size += len(chunk)

    file_entry = {
        "name": orig_name,
        "stored_as": saved_name,
        "size": size,
        "url": f"/api/uploads/hosting_{r['id']}/{saved_name}",
        "uploaded_at": utcnow().isoformat(),
    }
    await db.hosting_requests.update_one(
        {"upload_token": token},
        {"$push": {"uploaded_files": file_entry}},
    )
    if r.get("status") == "paid":
        await db.hosting_requests.update_one(
            {"upload_token": token},
            {"$set": {"status": "in_progress"}},
        )
    return {"ok": True, "file": file_entry}


@api_router.post("/hosting/upload/{token}/chunk")
async def hosting_upload_chunk(
    token: str,
    upload_id: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    filename: str = Form("fichier"),
    file: UploadFile = File(...),
):
    """Chunked upload endpoint for the public hosting flow.
    Use this for large video files (>50MB) to bypass proxy body-size limits.
    Frontend sends chunks of ~5 MB; the last chunk triggers assembly."""
    r = await db.hosting_requests.find_one({"upload_token": token}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Lien invalide.")
    if r.get("status") == "pending_payment":
        raise HTTPException(status_code=402, detail="Paiement requis avant l'envoi des fichiers.")
    if r.get("status") in ("rejected",):
        raise HTTPException(status_code=400, detail="Cette demande a été rejetée.")

    safe_upload_id = "".join(c for c in upload_id if c.isalnum() or c in "-_")
    if not safe_upload_id or len(safe_upload_id) > 80:
        raise HTTPException(status_code=400, detail="upload_id invalide")
    if chunk_index < 0 or total_chunks <= 0 or chunk_index >= total_chunks:
        raise HTTPException(status_code=400, detail="chunk_index hors-bornes")

    chunk_dir = CHUNKS_DIR / f"hosting_{safe_upload_id}"
    chunk_dir.mkdir(exist_ok=True)
    chunk_path = chunk_dir / f"chunk_{chunk_index:06d}"
    with chunk_path.open("wb") as f_out:
        while True:
            data = await file.read(1024 * 1024)
            if not data:
                break
            f_out.write(data)

    if chunk_index < total_chunks - 1:
        return {"ok": True, "chunk_index": chunk_index, "total_chunks": total_chunks}

    # LAST CHUNK → assemble
    orig_name = (filename or "fichier").replace("/", "_").replace("\\", "_")
    ext = ""
    if "." in orig_name:
        ext = "." + orig_name.rsplit(".", 1)[-1].lower()[:10]
    safe_id = secrets.token_hex(8)
    saved_name = f"{safe_id}{ext}"

    hosting_dir = UPLOAD_DIR / f"hosting_{r['id']}"
    hosting_dir.mkdir(exist_ok=True)
    final_path = hosting_dir / saved_name

    total_size = 0
    try:
        for i in range(total_chunks):
            p = chunk_dir / f"chunk_{i:06d}"
            if not p.exists():
                raise HTTPException(status_code=400, detail=f"Chunk {i} manquant — réessayez l'upload.")
        with final_path.open("wb") as out:
            for i in range(total_chunks):
                p = chunk_dir / f"chunk_{i:06d}"
                with p.open("rb") as src:
                    while True:
                        buf = src.read(4 * 1024 * 1024)
                        if not buf:
                            break
                        out.write(buf)
                        total_size += len(buf)
    finally:
        try:
            for p in chunk_dir.glob("chunk_*"):
                p.unlink()
            chunk_dir.rmdir()
        except Exception as e:
            logging.warning(f"Could not cleanup chunks: {e}")

    file_entry = {
        "name": orig_name,
        "stored_as": saved_name,
        "size": total_size,
        "url": f"/api/uploads/hosting_{r['id']}/{saved_name}",
        "uploaded_at": utcnow().isoformat(),
    }
    await db.hosting_requests.update_one(
        {"upload_token": token},
        {"$push": {"uploaded_files": file_entry}},
    )
    if r.get("status") == "paid":
        await db.hosting_requests.update_one(
            {"upload_token": token},
            {"$set": {"status": "in_progress"}},
        )
    return {"ok": True, "file": file_entry}


@api_router.delete("/hosting/upload/{token}/file/{stored_as}")
async def hosting_upload_delete_file(token: str, stored_as: str):
    """Public endpoint: lets the uploader remove a file they just uploaded (token-protected)."""
    r = await db.hosting_requests.find_one({"upload_token": token}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Lien invalide.")
    files = r.get("uploaded_files", [])
    new_files = [f for f in files if f.get("stored_as") != stored_as]
    if len(new_files) == len(files):
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    # Delete file from disk (best-effort)
    try:
        path = UPLOAD_DIR / f"hosting_{r['id']}" / stored_as
        if path.exists():
            path.unlink()
    except Exception as e:
        logging.warning(f"Could not delete file {stored_as}: {e}")
    await db.hosting_requests.update_one({"upload_token": token}, {"$set": {"uploaded_files": new_files}})
    return {"ok": True}




# --- ADMIN HOSTING ENDPOINTS are defined further below (after require_admin is declared) ---






@api_router.get("/videos/{video_id}")
async def get_video(video_id: str, code: Optional[str] = None, current: Optional[dict] = Depends(get_optional_user)):
    v = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vidéo introuvable")
    # check if user has unlocked
    unlocked = False
    # 0) Public showcase video → any authenticated user can watch (no code needed)
    if current and v.get("is_showcase"):
        unlocked = True
    # 1) Logged-in user with a recorded unlock OR an active subscription OR admin
    if not unlocked and current:
        u_doc = await db.user_unlocks.find_one({"user_id": current["id"], "video_id": video_id})
        unlocked = bool(u_doc) or bool(current.get("is_subscribed")) or bool(current.get("is_admin"))
        # Also accept wedding-level unlock (one unlock for all videos of the same wedding)
        if not unlocked:
            video_client_id = v.get("client_id") or slugify(v.get("title", ""))
            w_doc = await db.user_unlocks.find_one({"user_id": current["id"], "client_id": video_client_id})
            unlocked = bool(w_doc)
    # 2) Anonymous visitor with a valid wedding code → unlock full URL for this video
    if not unlocked and code:
        code_clean = code.strip().upper()
        rec = await db.unlock_codes.find_one({"code": code_clean, "is_active": True}, {"_id": 0})
        if rec:
            expired = bool(rec.get("expires_at") and rec["expires_at"] < utcnow())
            if not expired:
                # Resolve the wedding that this code unlocks
                code_client_id = rec.get("client_id")
                if not code_client_id and rec.get("video_id"):
                    vidoc = await db.videos.find_one({"id": rec["video_id"]}, {"_id": 0})
                    if vidoc:
                        code_client_id = vidoc.get("client_id") or slugify(vidoc.get("title", ""))
                # Check the code's wedding matches this video's wedding
                video_client_id = v.get("client_id") or slugify(v.get("title", ""))
                if code_client_id and code_client_id == video_client_id:
                    unlocked = True
    return video_to_public(v, include_full=unlocked)


@api_router.post("/videos/unlock")
async def unlock_video(body: UnlockRequest, current: dict = Depends(get_current_user)):
    code = body.code.strip().upper()
    rec = await db.unlock_codes.find_one({"code": code, "is_active": True}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Code invalide")
    if rec.get("expires_at") and rec["expires_at"] < utcnow():
        raise HTTPException(status_code=410, detail="Code expiré")
    if rec.get("max_uses") and rec.get("current_uses", 0) >= rec["max_uses"]:
        raise HTTPException(status_code=429, detail="Code épuisé")
    v = await db.videos.find_one({"id": rec["video_id"]}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vidéo introuvable")
    # record unlock
    await db.user_unlocks.update_one(
        {"user_id": current["id"], "video_id": v["id"]},
        {"$set": {
            "user_id": current["id"],
            "video_id": v["id"],
            "code": code,
            "unlocked_at": utcnow(),
        }},
        upsert=True,
    )
    await db.unlock_codes.update_one(
        {"code": code}, {"$inc": {"current_uses": 1}}
    )
    return {
        "ok": True,
        "video": video_to_public(v, include_full=True),
    }


@api_router.get("/library")
async def my_library(current: dict = Depends(get_current_user)):
    unlocks = await db.user_unlocks.find({"user_id": current["id"]}, {"_id": 0}).to_list(500)
    video_ids = [u["video_id"] for u in unlocks if u.get("video_id")]
    if not video_ids:
        return {"videos": []}
    videos = await db.videos.find({"id": {"$in": video_ids}}, {"_id": 0}).to_list(500)
    return {"videos": [video_to_public(v, include_full=True) for v in videos]}


# --- STRIPE SUBSCRIPTION ---
@api_router.post("/billing/checkout")
async def create_checkout(body: CheckoutRequest, current: dict = Depends(get_current_user)):
    if not STRIPE_API_KEY or STRIPE_API_KEY == "sk_test_emergent":
        raise HTTPException(
            status_code=503,
            detail="Stripe non configuré. Veuillez fournir une vraie clé Stripe sk_test_... dans STRIPE_API_KEY.",
        )
    try:
        # ensure customer
        customer_id = current.get("stripe_customer_id")
        if not customer_id:
            cust = stripe.Customer.create(email=current["email"], name=current.get("full_name", ""))
            customer_id = cust.id
            await db.users.update_one({"id": current["id"]}, {"$set": {"stripe_customer_id": customer_id}})

        success_url = body.success_url or f"{APP_PUBLIC_URL}/subscription?status=success&session_id={{CHECKOUT_SESSION_ID}}"
        cancel_url = body.cancel_url or f"{APP_PUBLIC_URL}/subscription?status=cancel"

        # NEW: prefer `plan` parameter (annual_commit / annual_free / monthly_free).
        # Fallback to legacy `tier` (basic → monthly_free, unlimited → monthly_free).
        plan_code = (body.plan or "").strip()
        if plan_code not in PLANS:
            legacy_tier = (body.tier or "basic").lower()
            plan_code = "monthly_free"  # default
            if legacy_tier == "basic":
                plan_code = "monthly_free"
            elif legacy_tier == "unlimited":
                plan_code = "monthly_free"
        plan_cfg = PLANS[plan_code]
        price_amount = plan_cfg["amount"]
        interval = plan_cfg["interval"]
        product_name = "CINÉMARIÉS — " + plan_cfg["label"]
        tier = plan_cfg["tier"]
        price_id = plan_cfg.get("price_id", "")

        # Prefer pre-created Stripe Price ID (clean catalog + analytics) when set,
        # otherwise fall back to inline price_data (legacy behavior).
        if price_id:
            line_item = {"price": price_id, "quantity": 1}
        else:
            line_item = {
                "price_data": {
                    "currency": STRIPE_PRICE_CURRENCY,
                    "product_data": {"name": product_name},
                    "recurring": {"interval": interval},
                    "unit_amount": price_amount,
                },
                "quantity": 1,
            }

        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=customer_id,
            line_items=[line_item],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"user_id": current["id"], "tier": tier, "plan": plan_code, "engagement": "1" if plan_cfg.get("engagement") else "0"},
        )
        await db.checkout_sessions.insert_one({
            "session_id": session.id,
            "user_id": current["id"],
            "tier": tier,
            "plan": plan_code,
            "status": "pending",
            "created_at": utcnow(),
        })
        return {"url": session.url, "session_id": session.id, "tier": tier, "plan": plan_code}
    except stripe.error.StripeError as e:  # type: ignore[attr-defined]
        logging.warning(f"Stripe error: {e}")
        raise HTTPException(status_code=502, detail=f"Erreur Stripe: {str(e)}")


@api_router.get("/billing/status")
async def billing_status(session_id: Optional[str] = None, current: dict = Depends(get_current_user)):
    if session_id and STRIPE_API_KEY:
        try:
            s = stripe.checkout.Session.retrieve(session_id)
            paid = s.get("payment_status") == "paid"
            if paid:
                update: dict = {"is_subscribed": True, "is_active": True}
                # Save plan/tier metadata
                meta = s.get("metadata") or {}
                plan_code = meta.get("plan")
                if plan_code and plan_code in PLANS:
                    cfg = PLANS[plan_code]
                    update["subscription_plan"] = plan_code
                    update["subscription_tier"] = cfg["tier"]
                    update["subscription_started_at"] = utcnow()
                    if cfg.get("engagement"):
                        # 12-month commitment ends in 12 months
                        update["subscription_ends_at"] = utcnow() + timedelta(days=365)
                # save subscription id for cancellation
                sub_id = s.get("subscription")
                if sub_id:
                    update["stripe_subscription_id"] = sub_id
                # Save customer id so future syncs can find the user
                cust_id = s.get("customer")
                if cust_id:
                    update["stripe_customer_id"] = cust_id
                await db.users.update_one({"id": current["id"]}, {"$set": update})
        except Exception as e:
            logging.warning(f"Stripe retrieve error: {e}")
    # 🔧 Fallback heal: also re-sync from Stripe API in case the webhook was missed
    if STRIPE_API_KEY:
        try:
            fresh = await db.users.find_one({"id": current["id"]}, {"_id": 0})
            if fresh:
                await _sync_subscription_from_stripe(fresh)
        except Exception as e:
            logging.warning(f"Stripe heal-sync failed: {e}")
    u = await db.users.find_one({"id": current["id"]}, {"_id": 0})
    return {
        "is_subscribed": bool(u.get("is_subscribed")),
        "is_active": u.get("is_active", True),
        "subscription_plan": u.get("subscription_plan"),
        "subscription_ends_at": u.get("subscription_ends_at"),
    }


@api_router.post("/billing/refresh")
async def billing_refresh(current: dict = Depends(get_current_user)):
    """Manually trigger a Stripe sync — heals missed webhooks for the current user."""
    if not STRIPE_API_KEY:
        return {"ok": False, "reason": "Stripe non configuré"}
    updated = await _sync_subscription_from_stripe(current)
    if updated:
        return {
            "ok": True,
            "is_subscribed": bool(updated.get("is_subscribed")),
            "subscription_plan": updated.get("subscription_plan"),
        }
    u = await db.users.find_one({"id": current["id"]}, {"_id": 0}) or current
    return {
        "ok": True,
        "is_subscribed": bool(u.get("is_subscribed")),
        "subscription_plan": u.get("subscription_plan"),
    }


@api_router.get("/billing/config")
async def billing_config():
    """Public config: returns publishable key and prices so the front-end can display info."""
    return {
        "publishable_key": STRIPE_PUBLISHABLE_KEY,
        "price_amount": STRIPE_PRICE_AMOUNT,
        "price_amount_unlimited": STRIPE_PRICE_AMOUNT_UNLIMITED,
        "price_currency": STRIPE_PRICE_CURRENCY,
        "basic_max_codes": BASIC_MAX_CODES,
        "max_devices_per_code": MAX_DEVICES_PER_CODE,
        "configured": bool(STRIPE_API_KEY and STRIPE_API_KEY != "sk_test_emergent"),
        "plans": [
            {
                "code": code,
                "label": cfg["label"],
                "amount": cfg["amount"],
                "interval": cfg["interval"],
                "engagement": cfg.get("engagement", False),
                "tier": cfg["tier"],
            }
            for code, cfg in PLANS.items()
        ],
    }


@api_router.post("/billing/cancel")
async def cancel_subscription(current: dict = Depends(get_current_user)):
    """Cancel the user's Stripe subscription (at the end of the current period).
    Does NOT deactivate the account — user keeps access until period end.
    Use /billing/cancel-and-deactivate for the full flow (cancel + deactivate immediately).
    """
    sub_id = current.get("stripe_subscription_id")
    if not sub_id:
        # try to look it up from customer
        cust_id = current.get("stripe_customer_id")
        if cust_id and STRIPE_API_KEY:
            try:
                subs = stripe.Subscription.list(customer=cust_id, status="active", limit=1)
                if subs and subs.data:
                    sub_id = subs.data[0].id
            except Exception as e:
                logging.warning(f"Stripe list subs error: {e}")
    if not sub_id:
        raise HTTPException(status_code=404, detail="Aucun abonnement actif trouvé")
    try:
        stripe.Subscription.modify(sub_id, cancel_at_period_end=True)
        return {"ok": True, "message": "Abonnement programmé pour résiliation à la fin de la période."}
    except stripe.error.StripeError as e:  # type: ignore[attr-defined]
        raise HTTPException(status_code=502, detail=f"Erreur Stripe: {str(e)}")


@api_router.post("/billing/cancel-and-deactivate")
async def cancel_and_deactivate(current: dict = Depends(get_current_user)):
    """Cancel the user's Stripe subscription IMMEDIATELY and deactivate the account.
    Behaviour per plan:
      • annual_commit  : cannot cancel before subscription_ends_at (12 months). HTTP 403 with the end date.
      • annual_free, monthly_free : cancels immediately, marks account is_active=false.
    Cannot deactivate an admin account.
    """
    if current.get("is_admin"):
        raise HTTPException(status_code=400, detail="Un compte administrateur ne peut pas être désactivé via cette route.")

    plan = current.get("subscription_plan")
    # Enforce 12-month engagement for annual_commit
    if plan == "annual_commit":
        ends_at = current.get("subscription_ends_at")
        if ends_at and isinstance(ends_at, datetime):
            ends_aware = ends_at if ends_at.tzinfo else ends_at.replace(tzinfo=timezone.utc)
            if ends_aware > utcnow():
                raise HTTPException(
                    status_code=403,
                    detail=f"Engagement 12 mois en cours. Vous pourrez résilier à partir du {ends_aware.strftime('%d/%m/%Y')}.",
                )

    # Cancel the Stripe subscription immediately (best-effort)
    sub_id = current.get("stripe_subscription_id")
    cust_id = current.get("stripe_customer_id")
    if not sub_id and cust_id and STRIPE_API_KEY:
        try:
            subs = stripe.Subscription.list(customer=cust_id, status="active", limit=1)
            if subs and subs.data:
                sub_id = subs.data[0].id
        except Exception as e:
            logging.warning(f"Stripe list subs error: {e}")
    cancelled = False
    if sub_id and STRIPE_API_KEY:
        try:
            stripe.Subscription.delete(sub_id)  # immediate cancellation
            cancelled = True
        except Exception as e:
            logging.warning(f"Stripe immediate cancel error: {e}")
            # Fallback: mark cancel_at_period_end so we don't get stuck
            try:
                stripe.Subscription.modify(sub_id, cancel_at_period_end=True)
            except Exception as e2:
                logging.warning(f"Stripe modify cancel error: {e2}")

    # Deactivate the account
    await db.users.update_one(
        {"id": current["id"]},
        {"$set": {
            "is_active": False,
            "is_subscribed": False,
            "deactivated_at": utcnow(),
            "subscription_plan": None,
            "subscription_tier": None,
            "subscription_ends_at": None,
            "stripe_subscription_id": None,
        }},
    )
    return {"ok": True, "stripe_cancelled": cancelled, "is_active": False}


class ReactivateRequest(BaseModel):
    plan: Optional[str] = None  # "annual_commit" | "annual_free" | "monthly_free"


@api_router.post("/billing/reactivate")
async def reactivate_account(body: ReactivateRequest, current: dict = Depends(get_current_user)):
    """Re-activates a deactivated account.
    Always returns a Stripe Checkout URL — the user MUST pay again to restore access.
    Once the payment succeeds and /billing/status is called, is_active=true is set back.
    """
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=503, detail="Stripe non configuré")
    plan_code = (body.plan or "monthly_free").strip()
    if plan_code not in PLANS:
        plan_code = "monthly_free"
    # Re-set is_active so the user is no longer blocked; we'll keep is_subscribed=false until payment.
    await db.users.update_one({"id": current["id"]}, {"$set": {"is_active": True}})
    # Create a new checkout session — re-use the existing logic
    checkout_body = CheckoutRequest(plan=plan_code)
    res = await create_checkout(checkout_body, current)  # type: ignore[arg-type]
    return res


@api_router.post("/billing/portal")
async def billing_portal(current: dict = Depends(get_current_user)):
    """Create a Stripe Customer Portal session so the user can manage their
    subscription (payment method, invoices, cancellation) on Stripe's hosted UI."""
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=503, detail="Stripe non configuré")
    cust_id = current.get("stripe_customer_id")
    if not cust_id:
        raise HTTPException(status_code=404, detail="Aucun client Stripe associé. Souscrivez d'abord à un abonnement.")
    try:
        return_url = f"{APP_PUBLIC_URL}/(tabs)/profile" if APP_PUBLIC_URL else "https://cinemaries.fr/(tabs)/profile"
        session = stripe.billing_portal.Session.create(
            customer=cust_id,
            return_url=return_url,
        )
        return {"url": session.url}
    except stripe.error.StripeError as e:  # type: ignore[attr-defined]
        raise HTTPException(status_code=502, detail=f"Erreur Stripe: {str(e)}")


@api_router.post("/billing/webhook")
async def stripe_webhook(request: Request, stripe_signature: Optional[str] = Header(None, alias="Stripe-Signature")):
    """Stripe webhook endpoint. Configure in Stripe Dashboard:
    https://dashboard.stripe.com/test/webhooks → endpoint: {APP_PUBLIC_URL}/api/billing/webhook
    Then set STRIPE_WEBHOOK_SECRET in backend/.env."""
    payload = await request.body()

    # Verify signature if a secret is configured (recommended for production)
    if STRIPE_WEBHOOK_SECRET and stripe_signature:
        try:
            event = stripe.Webhook.construct_event(
                payload=payload,
                sig_header=stripe_signature,
                secret=STRIPE_WEBHOOK_SECRET,
            )
        except Exception as e:
            logging.warning(f"Webhook signature verification failed: {e}")
            raise HTTPException(status_code=400, detail="Signature invalide")
    else:
        # No secret configured yet → parse raw event (dev only)
        try:
            import json as _json
            event = _json.loads(payload.decode("utf-8"))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"JSON invalide: {e}")

    event_type = event["type"] if isinstance(event, dict) else event.type
    obj = event["data"]["object"] if isinstance(event, dict) else event.data.object

    logging.info(f"[Stripe webhook] {event_type}")

    try:
        if event_type == "checkout.session.completed":
            customer_id = obj.get("customer")
            sub_id = obj.get("subscription")
            meta = obj.get("metadata") or {}
            kind = meta.get("kind")
            user_id = meta.get("user_id")
            tier = meta.get("tier") or "basic"

            if kind == "hosting_fee":
                # One-time hosting payment
                request_id = meta.get("request_id")
                if request_id:
                    await db.hosting_requests.update_one(
                        {"id": request_id},
                        {"$set": {
                            "status": "paid",
                            "paid_at": utcnow(),
                            "stripe_payment_intent_id": obj.get("payment_intent"),
                            "stripe_customer_id": customer_id,
                        }},
                    )
            elif user_id:
                # Subscription checkout (basic / unlimited)
                await db.users.update_one(
                    {"id": user_id},
                    {"$set": {
                        "is_subscribed": True,
                        "subscription_tier": tier,
                        "stripe_customer_id": customer_id,
                        "stripe_subscription_id": sub_id,
                    }},
                )
        elif event_type in ("customer.subscription.updated", "customer.subscription.created"):
            customer_id = obj.get("customer")
            status_v = obj.get("status")
            cancel_at_period_end = obj.get("cancel_at_period_end", False)
            is_premium = status_v in ("active", "trialing")
            if customer_id:
                await db.users.update_one(
                    {"stripe_customer_id": customer_id},
                    {"$set": {
                        "is_subscribed": is_premium,
                        "subscription_status": status_v,
                        "cancel_at_period_end": cancel_at_period_end,
                        "stripe_subscription_id": obj.get("id"),
                    }},
                )
        elif event_type == "customer.subscription.deleted":
            customer_id = obj.get("customer")
            if customer_id:
                await db.users.update_one(
                    {"stripe_customer_id": customer_id},
                    {"$set": {
                        "is_subscribed": False,
                        "subscription_status": "canceled",
                    }},
                )
        elif event_type == "invoice.payment_failed":
            customer_id = obj.get("customer")
            if customer_id:
                await db.users.update_one(
                    {"stripe_customer_id": customer_id},
                    {"$set": {"subscription_status": "past_due"}},
                )
    except Exception as e:
        logging.error(f"Webhook handler error for {event_type}: {e}")
        # We still return 200 so Stripe doesn't retry endlessly for our own bugs
    return {"received": True}


# --- SEED (admin) ---
@api_router.post("/admin/seed")
async def seed_data(secret: str):
    if secret != JWT_SECRET[:16]:
        raise HTTPException(status_code=403, detail="Forbidden")
    await _seed()
    return {"ok": True}


# ====== ADMIN ROUTES ======
async def require_admin(current: dict = Depends(get_current_user)) -> dict:
    if not current.get("is_admin"):
        raise HTTPException(status_code=403, detail="Accès réservé aux administrateurs")
    return current


class VideoCreate(BaseModel):
    title: str
    description: str = ""
    category: str = "À l'affiche"
    poster_url: str = ""
    hero_url: Optional[str] = None
    trailer_url: str = ""
    full_url: str = ""
    duration_minutes: int = 0
    is_featured: bool = False
    is_top_france: bool = False
    is_showcase: bool = False
    client_id: Optional[str] = None
    client_name: Optional[str] = None


class VideoUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    poster_url: Optional[str] = None
    hero_url: Optional[str] = None
    trailer_url: Optional[str] = None
    full_url: Optional[str] = None
    duration_minutes: Optional[int] = None
    is_featured: Optional[bool] = None
    is_top_france: Optional[bool] = None
    is_showcase: Optional[bool] = None
    client_id: Optional[str] = None
    client_name: Optional[str] = None


class CodeCreateRequest(BaseModel):
    client_id: Optional[str] = None  # new — preferred
    video_id: Optional[str] = None   # legacy / fallback
    max_uses: Optional[int] = None
    expires_in_hours: Optional[int] = None
    label: Optional[str] = None  # nom du client


@api_router.get("/admin/stats")
async def admin_stats(_: dict = Depends(require_admin)):
    users_count = await db.users.count_documents({})
    subs_count = await db.users.count_documents({"is_subscribed": True})
    videos_count = await db.videos.count_documents({})
    codes_count = await db.unlock_codes.count_documents({})
    active_codes = await db.unlock_codes.count_documents({"is_active": True})
    unlocks_count = await db.user_unlocks.count_documents({})

    # top videos
    pipeline = [
        {"$group": {"_id": "$video_id", "count": {"$sum": 1}}},
        {"$sort": {"count": -1}},
        {"$limit": 5},
    ]
    top_raw = await db.user_unlocks.aggregate(pipeline).to_list(5)
    top_videos = []
    for r in top_raw:
        v = await db.videos.find_one({"id": r["_id"]}, {"_id": 0, "title": 1, "poster_url": 1})
        if v:
            top_videos.append({"title": v["title"], "poster_url": v.get("poster_url"), "unlocks": r["count"]})

    return {
        "users": users_count,
        "premium": subs_count,
        "videos": videos_count,
        "codes_total": codes_count,
        "codes_active": active_codes,
        "unlocks_total": unlocks_count,
        "top_videos": top_videos,
    }


@api_router.get("/admin/videos")
async def admin_list_videos(_: dict = Depends(require_admin)):
    videos = await db.videos.find({}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    return {"videos": [video_to_public(v, include_full=True) for v in videos]}


@api_router.get("/admin/weddings/{client_id}/cover")
async def admin_get_wedding_cover(client_id: str, _: dict = Depends(require_admin)):
    """Return the wedding-level cover (poster + hero) overrides set by the admin.

    These OVERRIDE the auto-computed cover that takes the first/featured video poster.
    Use empty strings to clear and fall back to the auto behaviour.
    """
    doc = await db.wedding_meta.find_one({"client_id": client_id}, {"_id": 0}) or {}
    return {
        "client_id": client_id,
        "poster_url": doc.get("poster_url") or "",
        "hero_url": doc.get("hero_url") or "",
        "description": doc.get("description") or "",
    }


@api_router.put("/admin/weddings/{client_id}/cover")
async def admin_set_wedding_cover(client_id: str, body: dict, _: dict = Depends(require_admin)):
    """Set/update wedding-level cover (poster + hero) overrides.

    Body: { poster_url?: str, hero_url?: str, description?: str }
    Empty strings clear the override (auto-cover from video poster will be used).
    """
    poster_url = (body.get("poster_url") or "").strip()
    hero_url = (body.get("hero_url") or "").strip()
    description = body.get("description")
    update = {"client_id": client_id, "updated_at": utcnow()}
    if poster_url:
        update["poster_url"] = poster_url
    else:
        await db.wedding_meta.update_one({"client_id": client_id}, {"$unset": {"poster_url": ""}}, upsert=True)
    if hero_url:
        update["hero_url"] = hero_url
    else:
        await db.wedding_meta.update_one({"client_id": client_id}, {"$unset": {"hero_url": ""}}, upsert=True)
    if description is not None:
        if description.strip():
            update["description"] = description.strip()
        else:
            await db.wedding_meta.update_one({"client_id": client_id}, {"$unset": {"description": ""}}, upsert=True)
    await db.wedding_meta.update_one({"client_id": client_id}, {"$set": update}, upsert=True)
    doc = await db.wedding_meta.find_one({"client_id": client_id}, {"_id": 0}) or {}
    return {
        "ok": True,
        "client_id": client_id,
        "poster_url": doc.get("poster_url") or "",
        "hero_url": doc.get("hero_url") or "",
        "description": doc.get("description") or "",
    }


@api_router.get("/admin/weddings")
async def admin_list_weddings(_: dict = Depends(require_admin)):
    """List existing weddings (unique client_id + client_name pairs) so the admin
    can attach new videos to an existing wedding rather than creating a duplicate."""
    videos = await db.videos.find({}, {"_id": 0}).to_list(2000)
    groups: dict = {}
    for v in videos:
        cid = v.get("client_id") or slugify(v.get("title", ""))
        if not cid:
            continue
        if cid not in groups:
            groups[cid] = {
                "client_id": cid,
                "client_name": v.get("client_name") or v.get("title", ""),
                "video_count": 0,
                "poster_url": v.get("poster_url"),
                "created_at": v.get("created_at"),
            }
        groups[cid]["video_count"] += 1
        # keep the earliest created_at
        if v.get("created_at") and (not groups[cid]["created_at"] or v["created_at"] < groups[cid]["created_at"]):
            groups[cid]["created_at"] = v["created_at"]
    weddings = list(groups.values())
    # Latest first
    weddings.sort(key=lambda w: w.get("created_at") or utcnow(), reverse=True)
    for w in weddings:
        if w.get("created_at"):
            w["created_at"] = w["created_at"].isoformat() if hasattr(w["created_at"], "isoformat") else str(w["created_at"])
    return {"weddings": weddings}


@api_router.post("/admin/weddings/merge")
async def admin_merge_weddings(body: dict, _: dict = Depends(require_admin)):
    """Merge multiple weddings (by client_id) into a single target wedding.
    Body: { source_client_ids: [str], target_client_id: str, target_client_name?: str }
    All videos from sources are reassigned to target_client_id, and codes too.
    """
    source_ids = body.get("source_client_ids") or []
    target_id = (body.get("target_client_id") or "").strip()
    target_name = (body.get("target_client_name") or "").strip()
    if not target_id:
        raise HTTPException(status_code=400, detail="target_client_id requis")
    if not source_ids:
        raise HTTPException(status_code=400, detail="source_client_ids requis")
    moved = 0
    for sid in source_ids:
        if sid == target_id:
            continue
        update = {"client_id": target_id}
        if target_name:
            update["client_name"] = target_name
        # Move videos
        res = await db.videos.update_many({"client_id": sid}, {"$set": update})
        moved += res.modified_count or 0
        # Also handle videos that had no client_id but slugified to sid
        all_v = await db.videos.find({}, {"_id": 0, "id": 1, "title": 1, "client_id": 1, "client_name": 1}).to_list(2000)
        for v in all_v:
            if not v.get("client_id") and slugify(v.get("title", "")) == sid:
                await db.videos.update_one({"id": v["id"]}, {"$set": update})
                moved += 1
        # Move unlock_codes
        await db.unlock_codes.update_many({"client_id": sid}, {"$set": {"client_id": target_id}})
        # Move user_unlocks
        await db.user_unlocks.update_many({"client_id": sid}, {"$set": {"client_id": target_id}})
    return {"ok": True, "moved": moved, "target_client_id": target_id}


@api_router.post("/admin/videos")
async def admin_create_video(body: VideoCreate, _: dict = Depends(require_admin)):
    vid = str(uuid.uuid4())
    doc = body.model_dump()
    # auto-derive client_id from client_name or title if missing
    if not doc.get("client_id"):
        doc["client_id"] = slugify(doc.get("client_name") or doc.get("title", ""))
    if not doc.get("client_name"):
        doc["client_name"] = doc.get("title", "")
    doc.update({"id": vid, "is_private": True, "created_at": utcnow()})
    if not doc.get("hero_url"):
        doc["hero_url"] = doc.get("poster_url")
    await db.videos.insert_one(doc)
    doc.pop("_id", None)
    return {"video": video_to_public(doc, include_full=True)}


@api_router.patch("/admin/videos/{video_id}")
async def admin_update_video(video_id: str, body: VideoUpdate, _: dict = Depends(require_admin)):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="Aucun champ à mettre à jour")
    res = await db.videos.update_one({"id": video_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vidéo introuvable")
    v = await db.videos.find_one({"id": video_id}, {"_id": 0})
    return {"video": video_to_public(v, include_full=True)}


@api_router.delete("/admin/videos/{video_id}")
async def admin_delete_video(video_id: str, _: dict = Depends(require_admin)):
    res = await db.videos.delete_one({"id": video_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Vidéo introuvable")
    await db.unlock_codes.delete_many({"video_id": video_id})
    await db.user_unlocks.delete_many({"video_id": video_id})
    return {"ok": True}


@api_router.get("/admin/codes")
async def admin_list_codes(_: dict = Depends(require_admin)):
    codes = await db.unlock_codes.find({}, {"_id": 0}).sort("created_at", -1).to_list(2000)
    # Build maps to resolve titles by video_id OR by client_id (new codes are tied to a wedding)
    video_ids = list({c["video_id"] for c in codes if c.get("video_id")})
    client_ids = list({c.get("client_id") for c in codes if c.get("client_id")})

    title_by_video: dict[str, str] = {}
    if video_ids:
        vids = await db.videos.find({"id": {"$in": video_ids}}, {"_id": 0, "id": 1, "title": 1, "client_name": 1}).to_list(2000)
        title_by_video = {v["id"]: (v.get("client_name") or v.get("title", "?")) for v in vids}

    title_by_client: dict[str, str] = {}
    if client_ids:
        # Some videos may not have client_id stored; resolve via slugify(title) too
        all_v = await db.videos.find({}, {"_id": 0, "title": 1, "client_id": 1, "client_name": 1}).to_list(2000)
        for v in all_v:
            cid = v.get("client_id") or slugify(v.get("client_name") or v.get("title", ""))
            if cid in client_ids and cid not in title_by_client:
                title_by_client[cid] = v.get("client_name") or v.get("title", "?")

    out = []
    for c in codes:
        expired = bool(c.get("expires_at") and c["expires_at"] < utcnow())
        # Resolve a human-readable title
        title = "?"
        if c.get("video_id") and c["video_id"] in title_by_video:
            title = title_by_video[c["video_id"]]
        elif c.get("client_id") and c["client_id"] in title_by_client:
            title = title_by_client[c["client_id"]]
        out.append({
            "code": c["code"],
            "video_id": c.get("video_id"),
            "client_id": c.get("client_id"),
            "video_title": title,
            "label": c.get("label"),
            "is_active": c.get("is_active", True) and not expired,
            "expired": expired,
            "current_uses": c.get("current_uses", 0),
            "max_uses": c.get("max_uses"),
            "expires_at": c.get("expires_at").isoformat() if c.get("expires_at") else None,
            "created_at": c.get("created_at").isoformat() if c.get("created_at") else None,
        })
    return {"codes": out}


@api_router.post("/admin/codes")
async def admin_create_code(body: CodeCreateRequest, _: dict = Depends(require_admin)):
    client_id = body.client_id
    video_title = None
    if not client_id and body.video_id:
        v = await db.videos.find_one({"id": body.video_id}, {"_id": 0})
        if not v:
            raise HTTPException(status_code=404, detail="Vidéo introuvable")
        client_id = v.get("client_id") or slugify(v.get("title", ""))
        video_title = v.get("client_name") or v.get("title")
    if not client_id:
        raise HTTPException(status_code=400, detail="client_id ou video_id requis")
    # confirm at least one video exists for this client
    all_v = await db.videos.find({}, {"_id": 0}).to_list(500)
    matching = [v for v in all_v if (v.get("client_id") or slugify(v.get("title", ""))) == client_id]
    if not matching:
        raise HTTPException(status_code=404, detail="Aucun mariage pour ce client_id")
    if not video_title:
        video_title = matching[0].get("client_name") or matching[0].get("title")
    code = gen_unlock_code(8)
    expires_at = utcnow() + timedelta(hours=body.expires_in_hours) if body.expires_in_hours else None
    await db.unlock_codes.insert_one({
        "code": code,
        "client_id": client_id,
        "video_id": None,
        "label": body.label,
        "is_active": True,
        "max_uses": body.max_uses,
        "current_uses": 0,
        "expires_at": expires_at,
        "created_at": utcnow(),
    })
    return {"code": code, "video_title": video_title, "client_id": client_id, "video_count": len(matching)}


@api_router.delete("/admin/codes/{code}")
async def admin_revoke_code(code: str, _: dict = Depends(require_admin)):
    code = code.upper()
    res = await db.unlock_codes.update_one({"code": code}, {"$set": {"is_active": False}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Code introuvable")
    return {"ok": True}


@api_router.get("/admin/users")
async def admin_list_users(_: dict = Depends(require_admin)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(2000)
    # count unlocks per user
    pipe = [{"$group": {"_id": "$user_id", "count": {"$sum": 1}}}]
    counts = {x["_id"]: x["count"] for x in await db.user_unlocks.aggregate(pipe).to_list(2000)}
    out = []
    now = utcnow()
    for u in users:
        last = u.get("last_login_at")
        days_inactive = None
        if last:
            try:
                days_inactive = max(0, (now - last).days)
            except Exception:
                days_inactive = None
        out.append({
            "id": u["id"],
            "email": u["email"],
            "full_name": u.get("full_name", ""),
            "is_subscribed": u.get("is_subscribed", False),
            "is_admin": u.get("is_admin", False),
            "is_active": u.get("is_active", True),
            "subscription_tier": u.get("subscription_tier") or u.get("tier"),
            "client_id": u.get("client_id"),
            "unlocks": counts.get(u["id"], 0),
            "created_at": u.get("created_at").isoformat() if u.get("created_at") else None,
            "last_login_at": last.isoformat() if last else None,
            "days_inactive": days_inactive,
        })
    return {"users": out}


class AdminUserUpdate(BaseModel):
    email: Optional[str] = None
    full_name: Optional[str] = None
    is_admin: Optional[bool] = None
    is_subscribed: Optional[bool] = None
    is_active: Optional[bool] = None
    subscription_tier: Optional[str] = None  # "basic" | "unlimited" | None
    client_id: Optional[str] = None


@api_router.patch("/admin/users/{user_id}")
async def admin_update_user(user_id: str, body: AdminUserUpdate, current: dict = Depends(require_admin)):
    """Update any field of any user. Admins can promote/demote, change email, tier, etc.
    Safeguard: cannot demote the LAST remaining admin (system must always have at least 1)."""
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")

    updates: dict = {}
    if body.email is not None:
        new_email = body.email.strip().lower()
        if not new_email or "@" not in new_email:
            raise HTTPException(status_code=400, detail="Email invalide")
        # check email is not taken by someone else
        existing = await db.users.find_one({"email": new_email, "id": {"$ne": user_id}}, {"_id": 0, "id": 1})
        if existing:
            raise HTTPException(status_code=409, detail="Cet email est déjà utilisé par un autre compte")
        updates["email"] = new_email
    if body.full_name is not None:
        updates["full_name"] = body.full_name.strip()[:120]
    if body.is_admin is not None:
        # If demoting an admin → make sure at least 1 admin remains
        if target.get("is_admin") and body.is_admin is False:
            other_admins = await db.users.count_documents({"is_admin": True, "id": {"$ne": user_id}})
            if other_admins == 0:
                raise HTTPException(status_code=400, detail="Impossible de retirer le dernier administrateur du système.")
        updates["is_admin"] = bool(body.is_admin)
    if body.is_subscribed is not None:
        updates["is_subscribed"] = bool(body.is_subscribed)
    if body.is_active is not None:
        # prevent self-deactivation
        if user_id == current["id"] and body.is_active is False:
            raise HTTPException(status_code=400, detail="Vous ne pouvez pas désactiver votre propre compte.")
        updates["is_active"] = bool(body.is_active)
    if body.subscription_tier is not None:
        if body.subscription_tier not in (None, "", "basic", "unlimited"):
            raise HTTPException(status_code=400, detail="Tier invalide (basic / unlimited / vide)")
        updates["subscription_tier"] = body.subscription_tier or None
        updates["tier"] = body.subscription_tier or None  # backward compat
    if body.client_id is not None:
        if body.client_id == "":
            updates["client_id"] = None
        else:
            # verify wedding exists
            all_v = await db.videos.find({}, {"_id": 0, "client_id": 1, "title": 1}).to_list(500)
            slugs = {(v.get("client_id") or slugify(v.get("title", ""))) for v in all_v}
            if body.client_id not in slugs:
                raise HTTPException(status_code=404, detail=f"Mariage '{body.client_id}' introuvable")
            updates["client_id"] = body.client_id

    if not updates:
        raise HTTPException(status_code=400, detail="Aucun champ à modifier")

    updates["updated_at"] = utcnow()
    await db.users.update_one({"id": user_id}, {"$set": updates})
    updated = await db.users.find_one({"id": user_id}, {"_id": 0, "password_hash": 0})
    logging.info(f"[admin-update] {current.get('email')} → modified user {target.get('email')} fields={list(updates.keys())}")
    return {"ok": True, "user": user_to_public(updated)}


def _gen_temp_password(length: int = 12) -> str:
    import secrets, string
    alphabet = string.ascii_letters + string.digits
    # Always include at least 1 upper, 1 lower, 1 digit
    pwd = [
        secrets.choice(string.ascii_uppercase),
        secrets.choice(string.ascii_lowercase),
        secrets.choice(string.digits),
    ]
    pwd += [secrets.choice(alphabet) for _ in range(length - 3)]
    secrets.SystemRandom().shuffle(pwd)
    return "".join(pwd)


@api_router.post("/admin/users/{user_id}/reset-password")
async def admin_reset_password(user_id: str, current: dict = Depends(require_admin)):
    """Generate a random temporary password and store its hash. The plaintext password
    is returned ONCE to the admin so they can transmit it to the user (WhatsApp/email)."""
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    new_pw = _gen_temp_password(12)
    await db.users.update_one({"id": user_id}, {"$set": {
        "password_hash": hash_password(new_pw),
        "password_reset_at": utcnow(),
        "password_reset_by": current["id"],
    }})
    logging.info(f"[admin-reset-pwd] {current.get('email')} → reset password for {target.get('email')}")
    return {
        "ok": True,
        "email": target.get("email"),
        "temporary_password": new_pw,
        "message": "Communiquez ce mot de passe temporaire au client. Il devra le modifier après connexion."
    }


@api_router.delete("/admin/users/{user_id}")
async def admin_delete_user(user_id: str, current: dict = Depends(require_admin)):
    """Permanently delete a user and all their related data (unlocks, codes, hosting requests).
    Safeguards: cannot delete self, cannot delete last admin."""
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    if user_id == current["id"]:
        raise HTTPException(status_code=400, detail="Vous ne pouvez pas supprimer votre propre compte. Demandez à un autre administrateur.")
    if target.get("is_admin"):
        other_admins = await db.users.count_documents({"is_admin": True, "id": {"$ne": user_id}})
        if other_admins == 0:
            raise HTTPException(status_code=400, detail="Impossible de supprimer le dernier administrateur du système.")

    # Cascade delete
    await db.user_unlocks.delete_many({"user_id": user_id})
    await db.unlock_codes.update_many({"owner_user_id": user_id}, {"$set": {"is_active": False, "owner_revoked_at": utcnow()}})
    await db.hosting_requests.delete_many({"user_id": user_id})
    await db.deletion_requests.delete_many({"user_id": user_id})
    await db.checkout_sessions.delete_many({"user_id": user_id})
    await db.users.delete_one({"id": user_id})
    logging.info(f"[admin-delete-user] {current.get('email')} → deleted user {target.get('email')}")
    return {"ok": True, "deleted_email": target.get("email")}


@api_router.get("/admin/users/export.csv")
async def admin_users_export_csv(_: dict = Depends(require_admin)):
    """Export the full user directory as CSV (for archives / accounting)."""
    import csv, io
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).sort("created_at", -1).to_list(5000)
    buf = io.StringIO()
    w = csv.writer(buf, delimiter=";")
    w.writerow([
        "id", "email", "full_name", "is_admin", "is_subscribed", "tier",
        "client_id", "is_active", "created_at", "last_login_at",
    ])
    for u in users:
        w.writerow([
            u.get("id", ""),
            u.get("email", ""),
            u.get("full_name", ""),
            "yes" if u.get("is_admin") else "",
            "yes" if u.get("is_subscribed") else "",
            u.get("subscription_tier") or u.get("tier") or "",
            u.get("client_id") or "",
            "no" if u.get("is_active") is False else "yes",
            u.get("created_at").isoformat() if u.get("created_at") else "",
            u.get("last_login_at").isoformat() if u.get("last_login_at") else "",
        ])
    csv_bytes = buf.getvalue().encode("utf-8-sig")
    return Response(
        content=csv_bytes,
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f"attachment; filename=cinemaries_users_{utcnow().strftime('%Y%m%d')}.csv"},
    )


@api_router.post("/admin/users/{user_id}/assign-wedding")
async def admin_assign_wedding(user_id: str, body: AssignWeddingRequest, _: dict = Depends(require_admin)):
    """Link a user account to a specific wedding so they can self-generate codes."""
    # Verify the wedding exists
    all_v = await db.videos.find({}, {"_id": 0}).to_list(500)
    matching = [v for v in all_v if (v.get("client_id") or slugify(v.get("title", ""))) == body.client_id]
    if not matching:
        raise HTTPException(status_code=404, detail="Mariage introuvable")
    res = await db.users.update_one({"id": user_id}, {"$set": {"client_id": body.client_id}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    wedding_name = matching[0].get("client_name") or matching[0].get("title")
    return {"ok": True, "client_id": body.client_id, "client_name": wedding_name}


@api_router.delete("/admin/users/{user_id}/wedding")
async def admin_unassign_wedding(user_id: str, _: dict = Depends(require_admin)):
    res = await db.users.update_one({"id": user_id}, {"$unset": {"client_id": ""}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Utilisateur introuvable")
    return {"ok": True}


# --- ADMIN HOSTING REQUESTS ---
@api_router.get("/admin/hosting/requests")
async def admin_list_hosting(_: dict = Depends(require_admin), status: Optional[str] = None):
    q: dict = {}
    if status:
        q["status"] = status
    rs = await db.hosting_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(500)
    return {"requests": [hosting_to_public(r) for r in rs]}


@api_router.post("/admin/hosting/requests/{request_id}/publish")
async def admin_publish_hosting(request_id: str, _: dict = Depends(require_admin)):
    r = await db.hosting_requests.find_one({"id": request_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    if r.get("status") not in ("paid", "in_progress"):
        raise HTTPException(status_code=400, detail="Cette demande n'est pas encore payée.")

    client_id = slugify(r["couple_name"])
    base = client_id
    n = 1
    while await db.videos.find_one({"client_id": client_id}, {"_id": 1}):
        n += 1
        client_id = f"{base}-{n}"

    vid_id = str(uuid.uuid4())
    video_doc = {
        "id": vid_id,
        "title": r["couple_name"],
        "client_name": r["couple_name"],
        "client_id": client_id,
        "description": r.get("description") or "",
        "poster_url": "",
        "hero_url": "",
        "trailer_url": "",
        "full_url": "",
        "duration_minutes": 0,
        "category": "À l'affiche",
        "is_featured": False,
        "is_top_france": False,
        "is_private": True,
        "created_at": utcnow(),
    }
    await db.videos.insert_one(video_doc)

    await db.users.update_one({"id": r["user_id"]}, {"$set": {"client_id": client_id}})

    await db.hosting_requests.update_one(
        {"id": request_id},
        {"$set": {
            "status": "published",
            "client_id": client_id,
            "video_id": vid_id,
            "published_at": utcnow(),
        }},
    )

    return {"ok": True, "client_id": client_id, "video_id": vid_id}


@api_router.post("/admin/hosting/requests/{request_id}/reject")
async def admin_reject_hosting(request_id: str, _: dict = Depends(require_admin)):
    r = await db.hosting_requests.find_one({"id": request_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    await db.hosting_requests.update_one({"id": request_id}, {"$set": {"status": "rejected"}})
    return {"ok": True}


class HostingStatusUpdate(BaseModel):
    status: str  # 'pending', 'paid', 'in_progress', 'published', 'rejected', 'abandoned'


@api_router.patch("/admin/hosting/requests/{request_id}")
async def admin_update_hosting_status(request_id: str, body: HostingStatusUpdate, _: dict = Depends(require_admin)):
    """Manually change the status of a hosting request (e.g. mark as abandoned without deleting)."""
    allowed = {"pending", "paid", "in_progress", "published", "rejected", "abandoned"}
    if body.status not in allowed:
        raise HTTPException(status_code=400, detail=f"Statut invalide. Valeurs autorisées: {', '.join(sorted(allowed))}")
    r = await db.hosting_requests.find_one({"id": request_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    await db.hosting_requests.update_one(
        {"id": request_id},
        {"$set": {"status": body.status, "status_changed_at": utcnow()}},
    )
    return {"ok": True, "status": body.status}


@api_router.delete("/admin/hosting/requests/{request_id}")
async def admin_delete_hosting_request(request_id: str, _: dict = Depends(require_admin)):
    """Permanently delete a hosting request (typically for unfulfilled / abandoned ones).
    Files in uploads/ftp_drop/ tied to the request are NOT deleted automatically."""
    r = await db.hosting_requests.find_one({"id": request_id}, {"_id": 0})
    if not r:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    await db.hosting_requests.delete_one({"id": request_id})
    return {"ok": True}




@api_router.get("/admin/users/{user_id}/unlocks")
async def admin_user_unlocks(user_id: str, _: dict = Depends(require_admin)):
    unlocks = await db.user_unlocks.find({"user_id": user_id}, {"_id": 0}).to_list(500)
    ids = [u["video_id"] for u in unlocks]
    if not ids:
        return {"videos": []}
    vids = await db.videos.find({"id": {"$in": ids}}, {"_id": 0}).to_list(500)
    return {"videos": [video_to_public(v, include_full=True) for v in vids]}


@api_router.post("/admin/upload")
async def admin_upload(
    kind: str = Form("video"),  # video | image
    file: UploadFile = File(...),
    _: dict = Depends(require_admin),
):
    """Upload a video or image file. Returns a public URL."""
    if kind not in ("video", "image"):
        raise HTTPException(status_code=400, detail="kind doit être 'video' ou 'image'")
    ext = (file.filename or "").split(".")[-1].lower() if file.filename else "bin"
    if not ext or len(ext) > 5:
        ext = "mp4" if kind == "video" else "jpg"
    name = f"{uuid.uuid4().hex}.{ext}"
    dest = UPLOAD_DIR / name
    size = 0
    with dest.open("wb") as f:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            size += len(chunk)
            f.write(chunk)
    public_url = f"{APP_PUBLIC_URL}/api/uploads/{name}"
    await db.uploads.insert_one({
        "name": name,
        "kind": kind,
        "size": size,
        "content_type": file.content_type,
        "url": public_url,
        "created_at": utcnow(),
    })
    return {"url": public_url, "name": name, "size": size}


# --- CHUNKED UPLOAD (for large files that exceed proxy body-size limits) ---
CHUNKS_DIR = UPLOAD_DIR / ".chunks"
CHUNKS_DIR.mkdir(exist_ok=True)


@api_router.post("/admin/upload-chunk")
async def admin_upload_chunk(
    upload_id: str = Form(...),
    chunk_index: int = Form(...),
    total_chunks: int = Form(...),
    kind: str = Form("video"),
    filename: str = Form("file.mp4"),
    file: UploadFile = File(...),
    _: dict = Depends(require_admin),
):
    """Accept one chunk of a chunked upload.
    When the last chunk is received, all chunks are assembled into the final file
    and the public URL is returned.

    Frontend should:
      1. Generate a UUID `upload_id`
      2. Split the file into 5MB chunks
      3. POST each chunk with the same upload_id and incrementing chunk_index
      4. When chunk_index == total_chunks - 1, the response includes the final URL
    """
    if kind not in ("video", "image"):
        raise HTTPException(status_code=400, detail="kind doit être 'video' ou 'image'")
    # Safety: upload_id must be a hex/uuid-like string only
    safe_upload_id = "".join(c for c in upload_id if c.isalnum() or c in "-_")
    if not safe_upload_id or len(safe_upload_id) > 80:
        raise HTTPException(status_code=400, detail="upload_id invalide")
    if chunk_index < 0 or total_chunks <= 0 or chunk_index >= total_chunks:
        raise HTTPException(status_code=400, detail="chunk_index hors-bornes")

    chunk_dir = CHUNKS_DIR / safe_upload_id
    chunk_dir.mkdir(exist_ok=True)

    # Save chunk
    chunk_path = chunk_dir / f"chunk_{chunk_index:06d}"
    with chunk_path.open("wb") as f_out:
        while True:
            data = await file.read(1024 * 1024)
            if not data:
                break
            f_out.write(data)

    # If not the last chunk, just acknowledge
    if chunk_index < total_chunks - 1:
        return {"ok": True, "chunk_index": chunk_index, "total_chunks": total_chunks}

    # LAST CHUNK → assemble all chunks into a single file
    # Detect extension from provided filename
    ext = (filename or "").split(".")[-1].lower() if "." in filename else ""
    if not ext or len(ext) > 6:
        ext = "mp4" if kind == "video" else "jpg"
    final_name = f"{uuid.uuid4().hex}.{ext}"
    final_path = UPLOAD_DIR / final_name

    total_size = 0
    try:
        # Verify all chunks are present
        for i in range(total_chunks):
            p = chunk_dir / f"chunk_{i:06d}"
            if not p.exists():
                raise HTTPException(status_code=400, detail=f"Chunk {i} manquant — réessayez l'upload.")
        # Concatenate
        with final_path.open("wb") as out:
            for i in range(total_chunks):
                p = chunk_dir / f"chunk_{i:06d}"
                with p.open("rb") as src:
                    while True:
                        buf = src.read(4 * 1024 * 1024)
                        if not buf:
                            break
                        out.write(buf)
                        total_size += len(buf)
    finally:
        # Cleanup chunks regardless of success
        try:
            for p in chunk_dir.glob("chunk_*"):
                p.unlink()
            chunk_dir.rmdir()
        except Exception as e:
            logging.warning(f"Could not cleanup chunks for {safe_upload_id}: {e}")

    public_url = f"{APP_PUBLIC_URL}/api/uploads/{final_name}"
    await db.uploads.insert_one({
        "name": final_name,
        "kind": kind,
        "size": total_size,
        "content_type": None,
        "url": public_url,
        "chunked": True,
        "created_at": utcnow(),
    })
    return {"ok": True, "url": public_url, "name": final_name, "size": total_size}




# =========================
# CONTACT / DEVIS REQUESTS
# =========================
class ContactRequest(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    subject: Optional[str] = None
    wedding_date: Optional[str] = None
    location: Optional[str] = None
    message: str
    source: Optional[str] = "contact"


@api_router.post("/contact")
async def submit_contact(body: ContactRequest):
    """Public endpoint — clients can submit a quote/contact request without an account."""
    name = (body.name or "").strip()
    email = (body.email or "").strip()
    message = (body.message or "").strip()
    if not name or not email or not message:
        raise HTTPException(status_code=400, detail="Nom, email et message requis.")
    if len(message) > 5000:
        raise HTTPException(status_code=400, detail="Message trop long (max 5000 caractères).")
    doc = {
        "id": str(uuid.uuid4()),
        "name": name,
        "email": email,
        "phone": (body.phone or "").strip() or None,
        "subject": (body.subject or "").strip() or None,
        "wedding_date": (body.wedding_date or "").strip() or None,
        "location": (body.location or "").strip() or None,
        "message": message,
        "source": body.source or "contact",
        "status": "new",
        "created_at": utcnow(),
    }
    await db.contact_requests.insert_one(doc)
    return {"ok": True, "id": doc["id"]}


@api_router.get("/admin/contact-requests")
async def admin_list_contact_requests(_: dict = Depends(require_admin)):
    docs = await db.contact_requests.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    for d in docs:
        if d.get("created_at"):
            d["created_at"] = d["created_at"].isoformat() if hasattr(d["created_at"], "isoformat") else str(d["created_at"])
    return {"requests": docs}


@api_router.patch("/admin/contact-requests/{req_id}")
async def admin_update_contact_request(req_id: str, body: dict, _: dict = Depends(require_admin)):
    update = {}
    if "status" in body:
        update["status"] = body["status"]
    if "notes" in body:
        update["notes"] = body["notes"]
    if not update:
        raise HTTPException(status_code=400, detail="Aucune modification.")
    res = await db.contact_requests.update_one({"id": req_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    return {"ok": True}


@api_router.delete("/admin/contact-requests/{req_id}")
async def admin_delete_contact_request(req_id: str, _: dict = Depends(require_admin)):
    res = await db.contact_requests.delete_one({"id": req_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Demande introuvable")
    return {"ok": True}




@api_router.api_route("/uploads/{name:path}", methods=["GET", "HEAD"])
async def serve_upload(name: str, request: Request):
    """Serve uploaded files with HTTP Range support (required for Chromecast / video streaming).
    Also handles HEAD requests (used by some video players to get file metadata before streaming)."""
    if ".." in name:
        raise HTTPException(status_code=400, detail="Nom invalide")
    path = UPLOAD_DIR / name
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Fichier introuvable")

    import mimetypes
    ctype, _ = mimetypes.guess_type(str(path))
    if not ctype:
        ctype = "application/octet-stream"

    file_size = path.stat().st_size

    # HEAD request: return headers only with file info (no body)
    if request.method == "HEAD":
        return Response(
            content=b"",
            status_code=200,
            headers={
                "Content-Length": str(file_size),
                "Content-Type": ctype,
                "Accept-Ranges": "bytes",
            },
        )

    range_header = request.headers.get("range") or request.headers.get("Range")

    # Common headers for media playback + cross-origin (Chromecast)
    common_headers = {
        "accept-ranges": "bytes",
        "access-control-allow-origin": "*",
        "access-control-expose-headers": "Content-Range, Content-Length, Accept-Ranges",
        "cache-control": "public, max-age=3600",
    }

    if range_header:
        # Parse "bytes=START-END"
        try:
            units, rng = range_header.split("=")
            if units.strip().lower() != "bytes":
                raise ValueError("bad unit")
            start_s, end_s = rng.split("-")
            start = int(start_s) if start_s else 0
            end = int(end_s) if end_s else file_size - 1
            if start < 0 or end >= file_size or start > end:
                raise ValueError("bad range")
        except Exception:
            # Invalid range → 416 Range Not Satisfiable
            return Response(
                status_code=416,
                headers={**common_headers, "content-range": f"bytes */{file_size}"},
            )

        chunk_size = end - start + 1

        def iter_file():
            with open(path, "rb") as f:
                f.seek(start)
                remaining = chunk_size
                while remaining > 0:
                    data = f.read(min(1024 * 1024, remaining))
                    if not data:
                        break
                    remaining -= len(data)
                    yield data

        headers = {
            **common_headers,
            "content-range": f"bytes {start}-{end}/{file_size}",
            "content-length": str(chunk_size),
            "content-type": ctype,
        }
        return StreamingResponse(iter_file(), status_code=206, headers=headers, media_type=ctype)

    # Full file response (still with Accept-Ranges so client knows it CAN do ranges next time)
    headers = {
        **common_headers,
        "content-length": str(file_size),
        "content-type": ctype,
    }
    return FileResponse(str(path), headers=headers, media_type=ctype)


async def _seed():
    existing = await db.videos.count_documents({})
    if existing > 0:
        return
    posters = [
        "https://static.prod-images.emergentagent.com/jobs/4362e1b1-52b7-4479-8fd2-92fb85709661/images/b6f2b9862750337775217387cffe63a11740507034fc6a22a6f975d07c8d1911.png",
        "https://static.prod-images.emergentagent.com/jobs/4362e1b1-52b7-4479-8fd2-92fb85709661/images/21c1e6f2bcba0558d6575b191a1518f10ddbeb4f6a0e0979abd185543e639515.png",
        "https://images.unsplash.com/photo-1704584592205-7fac1784d5ce?crop=entropy&cs=srgb&fm=jpg&q=85",
        "https://images.unsplash.com/photo-1707194225411-833f136437a1?crop=entropy&cs=srgb&fm=jpg&q=85",
    ]
    hero = "https://static.prod-images.emergentagent.com/jobs/4362e1b1-52b7-4479-8fd2-92fb85709661/images/d5b4c495fdac5d60a3a99b8cd75e011119d272f44816d597bdcd7ac8a8615e2a.png"
    sample_trailer = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4"
    sample_full = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4"

    catalog = [
        {"title": "Camille & Antoine", "description": "Une cérémonie inoubliable au cœur de la Provence.", "category": "À l'affiche", "is_featured": True, "is_top_france": True, "poster": posters[0], "duration": 42},
        {"title": "Léa & Maxime", "description": "Un mariage royal au Château de Chantilly.", "category": "À l'affiche", "is_featured": True, "is_top_france": False, "poster": posters[1], "duration": 38},
        {"title": "Sarah & Julien", "description": "Cérémonie laïque sous les oliviers.", "category": "Cérémonies", "is_featured": False, "poster": posters[2], "duration": 27},
        {"title": "Emma & Thomas", "description": "Échange des vœux à l'aube.", "category": "Cérémonies", "is_featured": False, "poster": posters[3], "duration": 31},
        {"title": "Chloé & Lucas", "description": "Soirée dansante au Domaine des Roses.", "category": "Soirées", "is_featured": False, "poster": posters[0], "duration": 55},
        {"title": "Manon & Hugo", "description": "Une nuit étoilée, un feu d'artifice.", "category": "Soirées", "is_featured": False, "poster": posters[1], "duration": 48},
        {"title": "Best Of 2025", "description": "Les plus beaux moments de l'année.", "category": "Best Of", "is_featured": False, "poster": posters[2], "duration": 12},
        {"title": "Romance d'été", "description": "Compilation des mariages d'été.", "category": "Best Of", "is_featured": False, "poster": posters[3], "duration": 10},
    ]
    demo_codes = []
    for item in catalog:
        vid = str(uuid.uuid4())
        await db.videos.insert_one({
            "id": vid,
            "title": item["title"],
            "description": item["description"],
            "category": item["category"],
            "poster_url": item["poster"],
            "hero_url": hero,
            "trailer_url": sample_trailer,
            "full_url": sample_full,
            "duration_minutes": item["duration"],
            "is_featured": item.get("is_featured", False),
            "is_top_france": item.get("is_top_france", False),
            "is_private": True,
            "created_at": utcnow(),
        })
        # generate a demo code for the first 2 videos
        if item.get("is_featured"):
            code = gen_unlock_code(8)
            await db.unlock_codes.insert_one({
                "code": code,
                "video_id": vid,
                "is_active": True,
                "max_uses": 50,
                "current_uses": 0,
                "expires_at": None,
                "created_at": utcnow(),
            })
            demo_codes.append({"video": item["title"], "code": code})

    logging.info(f"Seeded {len(catalog)} videos. Demo codes: {demo_codes}")


@app.on_event("startup")
async def on_start():
    await db.users.create_index("email", unique=True)
    await db.videos.create_index("id", unique=True)
    await db.unlock_codes.create_index("code", unique=True)
    # user_unlocks: drop legacy strict index that breaks wedding-level docs
    # (multiple wedding-level docs per user have video_id=null and clash).
    try:
        existing_indexes = await db.user_unlocks.index_information()
        for name, info in existing_indexes.items():
            keys = info.get("key", [])
            if (
                name != "_id_"
                and info.get("unique")
                and keys == [("user_id", 1), ("video_id", 1)]
                and not info.get("partialFilterExpression")
            ):
                await db.user_unlocks.drop_index(name)
                logging.info(f"[startup] Dropped legacy strict unique index '{name}' on user_unlocks")
    except Exception as e:
        logging.warning(f"[startup] user_unlocks legacy index cleanup skipped: {e}")
    # New partial unique index: only enforce uniqueness for VIDEO-level unlocks
    # (video_id present). Wedding-level docs (video_id null) can coexist freely.
    await db.user_unlocks.create_index(
        [("user_id", 1), ("video_id", 1)],
        unique=True,
        partialFilterExpression={"video_id": {"$type": "string"}},
        name="user_unlocks_video_unique",
    )
    # Helper index for wedding-level lookups (not unique).
    await db.user_unlocks.create_index(
        [("user_id", 1), ("client_id", 1)],
        name="user_unlocks_wedding_lookup",
    )
    await _seed()
    await _seed_admin()


async def _seed_admin():
    existing = await db.users.find_one({"email": ADMIN_EMAIL.lower()})
    if existing:
        # ensure is_admin flag
        if not existing.get("is_admin"):
            await db.users.update_one({"_id": existing["_id"]}, {"$set": {"is_admin": True}})
        return
    await db.users.insert_one({
        "id": str(uuid.uuid4()),
        "email": ADMIN_EMAIL.lower(),
        "password_hash": hash_password(ADMIN_PASSWORD),
        "full_name": "Administrateur",
        "is_subscribed": True,
        "is_admin": True,
        "stripe_customer_id": None,
        "created_at": utcnow(),
    })
    logging.info(f"Admin seeded: {ADMIN_EMAIL}")


# ==========================================================================
# PUSH NOTIFICATIONS (Expo Push API)
# ==========================================================================
# DB schema: db.push_tokens = {
#   user_id: str,
#   expo_push_token: str,        # ExponentPushToken[xxx]
#   platform: "ios"|"android"|"web",
#   device_id: Optional[str],
#   created_at: datetime,
#   last_seen_at: datetime,
# }
# Unique on (user_id, expo_push_token).

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"


class PushTokenIn(BaseModel):
    expo_push_token: str
    platform: Optional[str] = None
    device_id: Optional[str] = None


@api_router.post("/notifications/register-token")
async def register_push_token(body: PushTokenIn, current=Depends(get_current_user)):
    """Register an Expo Push token for the current user.
    Idempotent — updates last_seen_at if token already exists.
    """
    tok = (body.expo_push_token or "").strip()
    if not tok or not (tok.startswith("ExponentPushToken[") or tok.startswith("ExpoPushToken[")):
        raise HTTPException(status_code=400, detail="Token Expo invalide")
    user_id = current["id"]
    now = utcnow()
    await db.push_tokens.update_one(
        {"user_id": user_id, "expo_push_token": tok},
        {
            "$set": {
                "platform": (body.platform or "unknown")[:16],
                "device_id": (body.device_id or "")[:80],
                "last_seen_at": now,
            },
            "$setOnInsert": {
                "user_id": user_id,
                "expo_push_token": tok,
                "created_at": now,
            },
        },
        upsert=True,
    )
    return {"ok": True}


@api_router.delete("/notifications/token")
async def unregister_push_token(token: str = "", current=Depends(get_current_user)):
    """Unregister a token (called on logout). If `token` query is empty, removes all tokens of the user."""
    user_id = current["id"]
    q: dict = {"user_id": user_id}
    if token:
        q["expo_push_token"] = token
    res = await db.push_tokens.delete_many(q)
    return {"ok": True, "deleted": res.deleted_count}


async def _send_expo_push(tokens: list[str], title: str, body: str, data: Optional[dict] = None) -> dict:
    """Send a batch of push notifications via Expo Push API.
    Expo accepts up to 100 messages per request. Returns {sent, failed, errors}.
    """
    if not tokens:
        return {"sent": 0, "failed": 0, "errors": []}
    # Dedupe + sanitize
    uniq = list({t for t in tokens if t})
    sent = 0
    failed = 0
    errors: list[str] = []
    invalid_tokens: list[str] = []
    # Batch 100
    async with httpx.AsyncClient(timeout=20) as http:
        for i in range(0, len(uniq), 100):
            batch = uniq[i : i + 100]
            messages = [
                {
                    "to": t,
                    "sound": "default",
                    "title": title,
                    "body": body,
                    "data": data or {},
                    "priority": "high",
                    "channelId": "default",
                }
                for t in batch
            ]
            try:
                r = await http.post(EXPO_PUSH_URL, json=messages, headers={"Accept": "application/json", "Content-Type": "application/json"})
                jr = r.json() if r.content else {}
                tickets = jr.get("data", []) if isinstance(jr, dict) else []
                if not isinstance(tickets, list):
                    tickets = []
                for idx, tk in enumerate(tickets):
                    if isinstance(tk, dict) and tk.get("status") == "ok":
                        sent += 1
                    else:
                        failed += 1
                        err = (tk or {}).get("message", "Unknown error") if isinstance(tk, dict) else "Unknown"
                        errors.append(err)
                        # Invalid token detection
                        details = (tk or {}).get("details") if isinstance(tk, dict) else None
                        if isinstance(details, dict) and details.get("error") in ("DeviceNotRegistered", "InvalidCredentials"):
                            invalid_tokens.append(batch[idx])
            except Exception as e:
                failed += len(batch)
                errors.append(str(e))
    # Cleanup invalid tokens
    if invalid_tokens:
        try:
            await db.push_tokens.delete_many({"expo_push_token": {"$in": invalid_tokens}})
        except Exception:
            pass
    return {"sent": sent, "failed": failed, "errors": errors[:5]}


async def _resolve_video_recipients(video_id: str, include_guests: bool) -> dict:
    """Return push_tokens + emails for a video's owner couple (and guests if asked)."""
    v = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vidéo introuvable")
    client_id = v.get("client_id") or slugify(v.get("client_name") or v.get("title", ""))

    # OWNER user(s) — users whose client_id matches AND who are not admin
    owner_q = {"client_id": client_id, "is_admin": {"$ne": True}}
    owners = await db.users.find(owner_q, {"_id": 0, "id": 1, "email": 1, "full_name": 1}).to_list(50)
    owner_ids = [u["id"] for u in owners]
    owner_emails = [u["email"] for u in owners if u.get("email")]

    guest_ids: list[str] = []
    guest_emails: list[str] = []
    if include_guests:
        # Guests = users who unlocked this wedding via code (user_unlocks), excluding owners
        unlocks = await db.user_unlocks.find(
            {"$or": [{"video_id": video_id}, {"client_id": client_id}]},
            {"_id": 0, "user_id": 1},
        ).to_list(2000)
        guest_user_ids_set = {u["user_id"] for u in unlocks if u.get("user_id")}
        # Exclude owners and admins
        guest_user_ids_set -= set(owner_ids)
        if guest_user_ids_set:
            gu = await db.users.find(
                {"id": {"$in": list(guest_user_ids_set)}, "is_admin": {"$ne": True}},
                {"_id": 0, "id": 1, "email": 1},
            ).to_list(2000)
            guest_ids = [u["id"] for u in gu]
            guest_emails = [u["email"] for u in gu if u.get("email")]

    all_user_ids = list(set(owner_ids + guest_ids))
    tokens_docs = (
        await db.push_tokens.find(
            {"user_id": {"$in": all_user_ids}} if all_user_ids else {"_id": None},
            {"_id": 0, "expo_push_token": 1, "user_id": 1},
        ).to_list(5000)
        if all_user_ids
        else []
    )
    tokens = [t["expo_push_token"] for t in tokens_docs if t.get("expo_push_token")]

    return {
        "video": v,
        "client_id": client_id,
        "owner_count": len(owners),
        "owner_emails": owner_emails,
        "guest_count": len(guest_ids),
        "guest_emails": guest_emails,
        "tokens": tokens,
        "user_ids": all_user_ids,
    }


@api_router.get("/admin/videos/{video_id}/notify-recipients")
async def admin_notify_recipients(video_id: str, include_guests: bool = False, _: dict = Depends(require_admin)):
    """Preview the recipients before sending."""
    info = await _resolve_video_recipients(video_id, include_guests)
    return {
        "video_id": video_id,
        "video_title": info["video"].get("title"),
        "client_name": info["video"].get("client_name"),
        "client_id": info["client_id"],
        "owners": info["owner_count"],
        "guests": info["guest_count"],
        "push_devices": len(info["tokens"]),
        "emails": len(set(info["owner_emails"] + info["guest_emails"])),
    }


class NotifyVideoIn(BaseModel):
    title: Optional[str] = None
    message: Optional[str] = None
    include_guests: bool = False
    send_email: bool = True
    send_push: bool = True


@api_router.post("/admin/videos/{video_id}/notify")
async def admin_notify_video(video_id: str, body: NotifyVideoIn, _: dict = Depends(require_admin)):
    """Send push + email to the wedding owner couple (and optionally guests)."""
    info = await _resolve_video_recipients(video_id, body.include_guests)
    v = info["video"]
    video_title = v.get("title", "Votre film de mariage")
    client_name = v.get("client_name") or video_title

    push_title = (body.title or "🎬 Votre film est en ligne !").strip()[:80]
    push_body = (body.message or f"{client_name} — Le film de votre plus beau jour vous attend dans CINÉMARIÉS. Ouvrez l'app pour le regarder.").strip()[:240]

    result_push = {"sent": 0, "failed": 0, "errors": []}
    result_email = {"sent": 0, "failed": 0}

    deep_link_path = f"/wedding/{info['client_id']}"

    if body.send_push and info["tokens"]:
        result_push = await _send_expo_push(
            info["tokens"],
            push_title,
            push_body,
            data={"type": "new_video", "video_id": video_id, "client_id": info["client_id"], "path": deep_link_path},
        )

    if body.send_email:
        emails = list({e for e in (info["owner_emails"] + info["guest_emails"]) if e})
        cta_url = f"{APP_PUBLIC_URL.rstrip('/') }{deep_link_path}"
        html_body = render_email(
            title=push_title,
            body_html=(
                f"<p>Bonjour,</p>"
                f"<p>{push_body}</p>"
                f"<p style='color:#9A9A9A;font-size:13px'>Mariage : <strong style='color:#D4AF37'>{client_name}</strong></p>"
                f"<p style='color:#9A9A9A;font-size:12px;font-style:italic'>Pour profiter pleinement de votre film, vous pouvez aussi installer l'app CINÉMARIÉS sur votre téléphone.</p>"
            ),
            cta_label="Regarder mon film",
            cta_url=cta_url,
        )
        for em in emails:
            try:
                ok = await send_email(em, push_title, html_body)
                if ok:
                    result_email["sent"] += 1
                else:
                    result_email["failed"] += 1
            except Exception as e:
                result_email["failed"] += 1
                logging.warning(f"[notify-video] email failed to {em}: {e}")

    # Log the notification event for audit
    try:
        await db.notification_log.insert_one({
            "id": str(uuid.uuid4()),
            "video_id": video_id,
            "client_id": info["client_id"],
            "title": push_title,
            "message": push_body,
            "include_guests": body.include_guests,
            "push_result": result_push,
            "email_result": result_email,
            "created_at": utcnow(),
        })
    except Exception:
        pass

    return {
        "ok": True,
        "push": result_push,
        "email": result_email,
        "recipients": {
            "owners": info["owner_count"],
            "guests": info["guest_count"],
            "push_devices": len(info["tokens"]),
            "emails": len(set(info["owner_emails"] + info["guest_emails"])),
        },
    }


# ==========================================================================
# SUPPORT CHAT — Tickets system (logged-in users ↔ admin)
# ==========================================================================
# Collections:
#   db.support_tickets   { id, user_id, user_email, user_name, subject, status,
#                          created_at, last_message_at, last_sender_role,
#                          unread_for_user (int), unread_for_admin (int) }
#   db.support_messages  { id, ticket_id, sender_id, sender_role ("user"|"admin"),
#                          sender_name, text, attachments [{url, kind}], created_at }
#
# Status values: "open", "in_progress", "closed"

ALLOWED_TICKET_STATUSES = {"open", "in_progress", "closed"}
SUPPORT_ADMIN_EMAIL = os.environ.get("ADMIN_NOTIFY_EMAIL", "") or os.environ.get("SMTP_FROM_EMAIL", "")


class TicketCreate(BaseModel):
    subject: str
    initial_message: Optional[str] = None
    attachments: Optional[List[dict]] = None  # [{url, kind}]


class TicketMessageCreate(BaseModel):
    text: str = ""
    attachments: Optional[List[dict]] = None


class TicketStatusUpdate(BaseModel):
    status: str  # "open" | "in_progress" | "closed"


async def _notify_new_support_message(ticket: dict, message: dict, recipient_role: str):
    """Send push + email when a new message is sent.
    recipient_role: 'admin' (user sent message) or 'user' (admin replied)
    """
    try:
        text_preview = (message.get("text") or "📎 Pièce jointe").strip()[:140]
        if recipient_role == "admin":
            title = f"💬 Nouveau message support : {ticket.get('subject', '')[:40]}"
            body = f"{ticket.get('user_name') or ticket.get('user_email')} : {text_preview}"
            # Send push to all admin users
            admins = await db.users.find({"is_admin": True}, {"_id": 0, "id": 1, "email": 1}).to_list(20)
            admin_ids = [a["id"] for a in admins]
            tokens = []
            if admin_ids:
                tdocs = await db.push_tokens.find({"user_id": {"$in": admin_ids}}, {"_id": 0, "expo_push_token": 1}).to_list(200)
                tokens = [t["expo_push_token"] for t in tdocs if t.get("expo_push_token")]
            if tokens:
                await _send_expo_push(tokens, title, body, data={"type": "support_message", "ticket_id": ticket["id"], "path": f"/admin/support/{ticket['id']}"})
            # Email to admin
            if SUPPORT_ADMIN_EMAIL:
                html_body = render_email(
                    title=title,
                    body_html=(
                        f"<p><strong>De :</strong> {ticket.get('user_name') or '-'} ({ticket.get('user_email')})</p>"
                        f"<p><strong>Sujet :</strong> {ticket.get('subject', '')}</p>"
                        f"<p><strong>Message :</strong></p>"
                        f"<p style='background:#0A0A0A;padding:12px;border-radius:6px;color:#F5F1E8'>{text_preview}</p>"
                    ),
                    cta_label="Répondre dans l'admin",
                    cta_url=f"{APP_PUBLIC_URL.rstrip('/')}/admin/support/{ticket['id']}",
                )
                await send_email(SUPPORT_ADMIN_EMAIL, title, html_body)
        else:
            # recipient_role == "user": notify the ticket owner
            title = f"💬 Réponse de CINÉMARIÉS"
            body = f"{ticket.get('subject', '')} : {text_preview}"
            uid = ticket.get("user_id")
            if uid:
                tdocs = await db.push_tokens.find({"user_id": uid}, {"_id": 0, "expo_push_token": 1}).to_list(20)
                tokens = [t["expo_push_token"] for t in tdocs if t.get("expo_push_token")]
                if tokens:
                    await _send_expo_push(tokens, title, body, data={"type": "support_message", "ticket_id": ticket["id"], "path": f"/support/{ticket['id']}"})
            if ticket.get("user_email"):
                html_body = render_email(
                    title="Vous avez reçu une réponse",
                    body_html=(
                        f"<p>Bonjour {ticket.get('user_name') or ''},</p>"
                        f"<p>Notre équipe a répondu à votre ticket <strong>« {ticket.get('subject', '')} »</strong> :</p>"
                        f"<p style='background:#0A0A0A;padding:12px;border-radius:6px;color:#F5F1E8'>{text_preview}</p>"
                    ),
                    cta_label="Voir la conversation",
                    cta_url=f"{APP_PUBLIC_URL.rstrip('/')}/support/{ticket['id']}",
                )
                await send_email(ticket["user_email"], title, html_body)
    except Exception as e:
        logging.warning(f"[support-notify] failed: {e}")


# ---------- USER endpoints ----------
@api_router.post("/support/tickets")
async def support_create_ticket(body: TicketCreate, current=Depends(get_current_user)):
    subj = (body.subject or "").strip()
    if not subj:
        raise HTTPException(status_code=400, detail="Le sujet est requis")
    if len(subj) > 140:
        subj = subj[:140]
    ticket_id = str(uuid.uuid4())
    now = utcnow()
    initial = (body.initial_message or "").strip()
    attachments = body.attachments or []
    if len(attachments) > 5:
        attachments = attachments[:5]
    ticket_doc = {
        "id": ticket_id,
        "user_id": current["id"],
        "user_email": current.get("email"),
        "user_name": current.get("full_name") or current.get("email"),
        "subject": subj,
        "status": "open",
        "created_at": now,
        "last_message_at": now,
        "last_sender_role": "user" if initial else None,
        "unread_for_user": 0,
        "unread_for_admin": 1 if initial else 0,
    }
    await db.support_tickets.insert_one(ticket_doc)
    msg_doc = None
    if initial or attachments:
        msg_doc = {
            "id": str(uuid.uuid4()),
            "ticket_id": ticket_id,
            "sender_id": current["id"],
            "sender_role": "user",
            "sender_name": current.get("full_name") or current.get("email"),
            "text": initial,
            "attachments": attachments,
            "created_at": now,
        }
        await db.support_messages.insert_one(msg_doc)
        # Notify admin
        await _notify_new_support_message(ticket_doc, msg_doc, recipient_role="admin")
    ticket_doc.pop("_id", None)
    return {"ticket": ticket_doc}


@api_router.get("/support/tickets")
async def support_list_my_tickets(current=Depends(get_current_user)):
    tickets = await db.support_tickets.find(
        {"user_id": current["id"]},
        {"_id": 0},
    ).sort("last_message_at", -1).to_list(200)
    return {"tickets": tickets}


@api_router.get("/support/tickets/{ticket_id}")
async def support_get_ticket(ticket_id: str, current=Depends(get_current_user)):
    t = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket introuvable")
    if t.get("user_id") != current["id"] and not current.get("is_admin"):
        raise HTTPException(status_code=403, detail="Accès refusé")
    msgs = await db.support_messages.find({"ticket_id": ticket_id}, {"_id": 0}).sort("created_at", 1).to_list(2000)
    return {"ticket": t, "messages": msgs}


@api_router.post("/support/tickets/{ticket_id}/messages")
async def support_send_message(ticket_id: str, body: TicketMessageCreate, current=Depends(get_current_user)):
    t = await db.support_tickets.find_one({"id": ticket_id})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket introuvable")
    if t.get("user_id") != current["id"] and not current.get("is_admin"):
        raise HTTPException(status_code=403, detail="Accès refusé")
    txt = (body.text or "").strip()
    attachments = body.attachments or []
    if not txt and not attachments:
        raise HTTPException(status_code=400, detail="Message vide")
    if len(txt) > 4000:
        txt = txt[:4000]
    if len(attachments) > 5:
        attachments = attachments[:5]
    is_admin_sender = bool(current.get("is_admin")) and t.get("user_id") != current["id"]
    role = "admin" if is_admin_sender else "user"
    now = utcnow()
    msg_doc = {
        "id": str(uuid.uuid4()),
        "ticket_id": ticket_id,
        "sender_id": current["id"],
        "sender_role": role,
        "sender_name": "Support CINÉMARIÉS" if role == "admin" else (current.get("full_name") or current.get("email")),
        "text": txt,
        "attachments": attachments,
        "created_at": now,
    }
    await db.support_messages.insert_one(msg_doc)
    # Update ticket counters
    update = {
        "last_message_at": now,
        "last_sender_role": role,
    }
    if role == "admin":
        update["unread_for_user"] = t.get("unread_for_user", 0) + 1
        # Reset admin unread because admin just replied (any pending should be seen)
    else:
        update["unread_for_admin"] = t.get("unread_for_admin", 0) + 1
    # Reopen if closed
    if t.get("status") == "closed":
        update["status"] = "open"
    await db.support_tickets.update_one({"id": ticket_id}, {"$set": update})
    t.update(update)
    t.pop("_id", None)
    msg_doc_ret = {**msg_doc}
    msg_doc_ret.pop("_id", None)
    # Notify the OTHER side
    recipient = "user" if role == "admin" else "admin"
    await _notify_new_support_message(t, msg_doc_ret, recipient_role=recipient)
    return {"message": msg_doc_ret, "ticket": t}


@api_router.post("/support/tickets/{ticket_id}/mark-read")
async def support_mark_read(ticket_id: str, current=Depends(get_current_user)):
    t = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket introuvable")
    is_owner = t.get("user_id") == current["id"]
    is_admin = bool(current.get("is_admin"))
    if not is_owner and not is_admin:
        raise HTTPException(status_code=403, detail="Accès refusé")
    update = {}
    if is_owner:
        update["unread_for_user"] = 0
    if is_admin and not is_owner:
        update["unread_for_admin"] = 0
    if update:
        await db.support_tickets.update_one({"id": ticket_id}, {"$set": update})
    return {"ok": True}


@api_router.patch("/support/tickets/{ticket_id}")
async def support_user_close_ticket(ticket_id: str, body: TicketStatusUpdate, current=Depends(get_current_user)):
    """User can close their own ticket (or reopen)."""
    t = await db.support_tickets.find_one({"id": ticket_id}, {"_id": 0})
    if not t:
        raise HTTPException(status_code=404, detail="Ticket introuvable")
    if t.get("user_id") != current["id"] and not current.get("is_admin"):
        raise HTTPException(status_code=403, detail="Accès refusé")
    status_val = (body.status or "").strip().lower()
    if status_val not in ALLOWED_TICKET_STATUSES:
        raise HTTPException(status_code=400, detail="Statut invalide")
    await db.support_tickets.update_one({"id": ticket_id}, {"$set": {"status": status_val}})
    t["status"] = status_val
    return {"ticket": t}


# ---------- Image upload for support (auth user) ----------
@api_router.post("/support/upload")
async def support_upload_image(
    file: UploadFile = File(...),
    current=Depends(get_current_user),
):
    """Upload an image attachment for a support message. Returns public URL.
    Limited to images <= 8 MB. Returns 413 if too big.
    """
    ext = (file.filename or "").split(".")[-1].lower() if file.filename else "jpg"
    if not ext or len(ext) > 5 or ext not in ("jpg", "jpeg", "png", "webp", "gif", "heic", "heif"):
        ext = "jpg"
    name = f"support_{uuid.uuid4().hex}.{ext}"
    dest = UPLOAD_DIR / name
    size = 0
    MAX = 8 * 1024 * 1024  # 8 MB
    with dest.open("wb") as f:
        while True:
            chunk = await file.read(256 * 1024)
            if not chunk:
                break
            size += len(chunk)
            if size > MAX:
                try:
                    f.close()
                    dest.unlink(missing_ok=True)
                except Exception:
                    pass
                raise HTTPException(status_code=413, detail="Image trop grande (max 8 MB)")
            f.write(chunk)
    public_url = f"{APP_PUBLIC_URL}/api/uploads/{name}"
    await db.uploads.insert_one({
        "name": name,
        "kind": "support_image",
        "size": size,
        "content_type": file.content_type,
        "url": public_url,
        "owner_user_id": current["id"],
        "created_at": utcnow(),
    })
    return {"url": public_url, "name": name, "size": size}


# ---------- ADMIN endpoints ----------
@api_router.get("/admin/support/tickets")
async def admin_list_tickets(status: Optional[str] = None, _: dict = Depends(require_admin)):
    q: dict = {}
    if status and status in ALLOWED_TICKET_STATUSES:
        q["status"] = status
    tickets = await db.support_tickets.find(q, {"_id": 0}).sort("last_message_at", -1).to_list(500)
    # Counters: total unread for admin
    total_unread = sum((t.get("unread_for_admin", 0) or 0) for t in tickets)
    open_count = sum(1 for t in tickets if t.get("status") == "open")
    return {"tickets": tickets, "total_unread": total_unread, "open_count": open_count}


@api_router.get("/admin/support/unread-count")
async def admin_unread_count(_: dict = Depends(require_admin)):
    """Quick poll endpoint for the admin badge."""
    agg = await db.support_tickets.aggregate([
        {"$group": {"_id": None, "total": {"$sum": "$unread_for_admin"}}}
    ]).to_list(1)
    total = (agg[0]["total"] if agg else 0) or 0
    return {"unread": int(total)}


@api_router.patch("/admin/support/tickets/{ticket_id}")
async def admin_update_ticket(ticket_id: str, body: TicketStatusUpdate, _: dict = Depends(require_admin)):
    status_val = (body.status or "").strip().lower()
    if status_val not in ALLOWED_TICKET_STATUSES:
        raise HTTPException(status_code=400, detail="Statut invalide")
    res = await db.support_tickets.update_one({"id": ticket_id}, {"$set": {"status": status_val}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Ticket introuvable")
    return {"ok": True, "status": status_val}


@api_router.delete("/admin/support/tickets/{ticket_id}")
async def admin_delete_ticket(ticket_id: str, _: dict = Depends(require_admin)):
    res = await db.support_tickets.delete_one({"id": ticket_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Ticket introuvable")
    await db.support_messages.delete_many({"ticket_id": ticket_id})
    return {"ok": True}


# ---------- USER unread count (for profile badge) ----------
@api_router.get("/support/unread-count")
async def user_unread_count(current=Depends(get_current_user)):
    agg = await db.support_tickets.aggregate([
        {"$match": {"user_id": current["id"]}},
        {"$group": {"_id": None, "total": {"$sum": "$unread_for_user"}}}
    ]).to_list(1)
    total = (agg[0]["total"] if agg else 0) or 0
    return {"unread": int(total)}


# ==========================================================================
# QUOTE REQUESTS (Devis) — Public form + Admin management
# ==========================================================================
# Collection: db.quote_requests {
#   id, status, created_at, updated_at,
#   wedding_date, location, guests_count, ceremony_types[],
#   coverage_items[], options_items[], deliverables_items[],
#   custom_message,
#   contact_name, partner_name, email, phone, source, accepted_terms,
#   admin_notes,
#   computed_total_min (cents)
# }

ALLOWED_QUOTE_STATUSES = {"new", "in_progress", "sent", "accepted", "refused", "archived"}

# Source of truth for the items + their prices (only some have prices on creativindustry.com)
QUOTE_ITEMS_CATALOG = {
    "couverture": [
        {"id": "prep_mariee", "label": "Préparatifs Mariée", "price": 0},
        {"id": "prep_marie", "label": "Préparatifs Marié", "price": 0},
        {"id": "cer_civile", "label": "Cérémonie Civile", "price": 0},
        {"id": "cer_religieuse", "label": "Cérémonie Religieuse", "price": 0},
        {"id": "cer_laique", "label": "Cérémonie Laïque", "price": 0},
        {"id": "vin_honneur", "label": "Vin d'honneur", "price": 0},
        {"id": "soiree", "label": "Soirée & Réception", "price": 350},
        {"id": "maoulid", "label": "Maoulid", "price": 0},
        {"id": "oukoumbi", "label": "Oukoumbi", "price": 0},
        {"id": "mlazomoina", "label": "mlazomoina", "price": 0},
        {"id": "mtaho", "label": "mtaho", "price": 0},
        {"id": "henne", "label": "henné", "price": 0},
        {"id": "photographe_journees", "label": "Photographe journées", "price": 0},
    ],
    "options": [
        {"id": "drone", "label": "Drone", "price": 400},
        {"id": "seance_couple", "label": "Séance Couple", "price": 300},
        {"id": "photobooth", "label": "Photobooth", "price": 450},
        {"id": "livre_or", "label": "Livre d'or numérique", "price": 200},
    ],
    "livrables": [
        {"id": "film_teaser", "label": "Film Teaser 3min", "price": 300},
        {"id": "album_photo", "label": "Album Photo 30 pages", "price": 400},
    ],
}


def _item_label(category: str, item_id: str) -> Optional[dict]:
    for it in QUOTE_ITEMS_CATALOG.get(category, []):
        if it["id"] == item_id:
            return it
    return None


class QuoteCreate(BaseModel):
    wedding_date: Optional[str] = None
    location: Optional[str] = ""
    guests_count: Optional[int] = None
    ceremony_types: Optional[List[str]] = None
    coverage_items: Optional[List[str]] = None
    options_items: Optional[List[str]] = None
    deliverables_items: Optional[List[str]] = None
    custom_message: Optional[str] = ""
    contact_name: str
    partner_name: Optional[str] = ""
    email: EmailStr
    phone: str
    source: Optional[str] = ""
    accepted_terms: bool = False


class QuoteStatusUpdate(BaseModel):
    status: Optional[str] = None
    admin_notes: Optional[str] = None


@api_router.get("/devis/catalog")
async def get_quote_catalog():
    """Public: returns the catalog of items the user can pick."""
    return {"catalog": QUOTE_ITEMS_CATALOG}


@api_router.post("/devis")
async def create_quote_request(body: QuoteCreate, current=Depends(get_optional_user)):
    if not body.accepted_terms:
        raise HTTPException(status_code=400, detail="Vous devez accepter le traitement de vos données (RGPD).")
    if not body.email or not body.phone or not body.contact_name:
        raise HTTPException(status_code=400, detail="Nom, email et téléphone sont obligatoires.")

    coverage = body.coverage_items or []
    options = body.options_items or []
    livrables = body.deliverables_items or []
    if not coverage and not options and not livrables:
        raise HTTPException(status_code=400, detail="Sélectionnez au moins une prestation.")

    # Resolve labels + min total
    def resolve(cat: str, ids: List[str]) -> List[dict]:
        out = []
        for i in ids:
            it = _item_label(cat, i)
            if it:
                out.append({"id": it["id"], "label": it["label"], "price": it["price"]})
        return out

    coverage_full = resolve("couverture", coverage)
    options_full = resolve("options", options)
    livrables_full = resolve("livrables", livrables)
    computed_total_min = sum((x.get("price") or 0) for x in (coverage_full + options_full + livrables_full))

    quote_id = str(uuid.uuid4())
    now = utcnow()
    doc = {
        "id": quote_id,
        "status": "new",
        "user_id": current["id"] if current else None,
        "wedding_date": body.wedding_date or "",
        "location": (body.location or "")[:200],
        "guests_count": body.guests_count,
        "ceremony_types": body.ceremony_types or [],
        "coverage_items": coverage_full,
        "options_items": options_full,
        "deliverables_items": livrables_full,
        "custom_message": (body.custom_message or "")[:4000],
        "contact_name": body.contact_name[:120],
        "partner_name": (body.partner_name or "")[:120],
        "email": body.email.lower(),
        "phone": body.phone[:40],
        "source": (body.source or "")[:80],
        "accepted_terms": True,
        "admin_notes": "",
        "computed_total_min": computed_total_min,
        "created_at": now,
        "updated_at": now,
    }
    await db.quote_requests.insert_one(doc)

    # Build recap for the email
    def format_items_html(items: List[dict]) -> str:
        if not items:
            return "<li><em>Aucun</em></li>"
        out = []
        for it in items:
            price_str = f" — <strong>{it['price']}€</strong>" if it.get("price") else ""
            out.append(f"<li>{it['label']}{price_str}</li>")
        return "".join(out)

    couple_line = body.partner_name and f"{body.contact_name} & {body.partner_name}" or body.contact_name
    total_line = f"<p style='color:#D4AF37;font-weight:bold;font-size:16px'>Total estimé minimum : {computed_total_min}€</p>" if computed_total_min else ""

    admin_html = render_email(
        title=f"📝 Nouvelle demande de devis — {couple_line}",
        body_html=(
            f"<p><strong>Couple :</strong> {couple_line}</p>"
            f"<p><strong>Date du mariage :</strong> {body.wedding_date or 'À définir'}</p>"
            f"<p><strong>Lieu :</strong> {body.location or '-'}</p>"
            f"<p><strong>Nombre d'invités :</strong> {body.guests_count or '-'}</p>"
            f"<p><strong>Email :</strong> <a href='mailto:{body.email}' style='color:#D4AF37'>{body.email}</a></p>"
            f"<p><strong>Téléphone :</strong> <a href='tel:{body.phone}' style='color:#D4AF37'>{body.phone}</a></p>"
            f"<p><strong>Comment nous a-t-il connu :</strong> {body.source or '-'}</p>"
            f"<hr style='border-color:#333'/>"
            f"<h3 style='color:#D4AF37'>🎬 Couverture</h3><ul style='color:#F5F1E8'>{format_items_html(coverage_full)}</ul>"
            f"<h3 style='color:#D4AF37'>✨ Options</h3><ul style='color:#F5F1E8'>{format_items_html(options_full)}</ul>"
            f"<h3 style='color:#D4AF37'>🎁 Livrables</h3><ul style='color:#F5F1E8'>{format_items_html(livrables_full)}</ul>"
            f"{total_line}"
            + (f"<hr style='border-color:#333'/><h3 style='color:#D4AF37'>💬 Message du couple</h3><p style='background:#0A0A0A;padding:12px;border-radius:6px;color:#F5F1E8'>{body.custom_message}</p>" if body.custom_message else "")
        ),
        cta_label="Voir dans l'admin",
        cta_url=f"{APP_PUBLIC_URL.rstrip('/')}/admin/devis/{quote_id}",
    )

    client_html = render_email(
        title="✓ Nous avons bien reçu votre demande",
        body_html=(
            f"<p>Bonjour {body.contact_name},</p>"
            f"<p>Merci de votre confiance ! Nous avons bien reçu votre demande de devis pour votre mariage{(' du ' + body.wedding_date) if body.wedding_date else ''}.</p>"
            f"<p>Notre équipe étudie votre projet et vous recontactera <strong style='color:#D4AF37'>sous 48 heures</strong> pour vous proposer une formule personnalisée.</p>"
            f"<p style='color:#9A9A9A;font-size:12px'>Si votre demande est urgente, vous pouvez nous joindre au <strong>07 49 20 89 22</strong>.</p>"
            f"<p style='color:#9A9A9A;font-size:12px;margin-top:24px'>À très vite,<br/>L'équipe CINÉMARIÉS / CREATIVINDUSTRY</p>"
        ),
        cta_label="Visiter notre site",
        cta_url=APP_PUBLIC_URL or "https://cinemaries.fr",
    )

    # Send emails (best-effort)
    admin_to = os.environ.get("ADMIN_NOTIFY_EMAIL") or os.environ.get("SMTP_FROM_EMAIL") or "contact@creativindustry.com"
    try:
        await send_email(admin_to, f"📝 Devis — {couple_line}", admin_html)
    except Exception as e:
        logging.warning(f"[devis] admin email failed: {e}")
    try:
        await send_email(body.email, "✓ Devis CINÉMARIÉS reçu", client_html)
    except Exception as e:
        logging.warning(f"[devis] client confirmation email failed: {e}")

    doc_ret = {**doc}
    doc_ret.pop("_id", None)
    return {"quote": doc_ret}


@api_router.get("/admin/devis")
async def admin_list_devis(status: Optional[str] = None, _: dict = Depends(require_admin)):
    q: dict = {}
    if status and status in ALLOWED_QUOTE_STATUSES:
        q["status"] = status
    quotes = await db.quote_requests.find(q, {"_id": 0}).sort("created_at", -1).to_list(1000)
    # Counts
    pipeline = [{"$group": {"_id": "$status", "count": {"$sum": 1}}}]
    counts_arr = await db.quote_requests.aggregate(pipeline).to_list(20)
    counts = {c["_id"]: c["count"] for c in counts_arr}
    return {"quotes": quotes, "counts": counts, "total": sum(counts.values())}


@api_router.get("/admin/devis/{quote_id}")
async def admin_get_devis(quote_id: str, _: dict = Depends(require_admin)):
    q = await db.quote_requests.find_one({"id": quote_id}, {"_id": 0})
    if not q:
        raise HTTPException(status_code=404, detail="Devis introuvable")
    return {"quote": q}


@api_router.patch("/admin/devis/{quote_id}")
async def admin_update_devis(quote_id: str, body: QuoteStatusUpdate, _: dict = Depends(require_admin)):
    updates: dict = {"updated_at": utcnow()}
    if body.status is not None:
        if body.status not in ALLOWED_QUOTE_STATUSES:
            raise HTTPException(status_code=400, detail="Statut invalide")
        updates["status"] = body.status
    if body.admin_notes is not None:
        updates["admin_notes"] = body.admin_notes[:4000]
    res = await db.quote_requests.update_one({"id": quote_id}, {"$set": updates})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Devis introuvable")
    q = await db.quote_requests.find_one({"id": quote_id}, {"_id": 0})
    return {"quote": q}


@api_router.delete("/admin/devis/{quote_id}")
async def admin_delete_devis(quote_id: str, _: dict = Depends(require_admin)):
    res = await db.quote_requests.delete_one({"id": quote_id})
    if res.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Devis introuvable")
    return {"ok": True}


# Include router
register_photo_routes(
    api_router=api_router,
    db=db,
    UPLOAD_DIR=UPLOAD_DIR,
    get_current_user=get_optional_user,
    require_admin=require_admin,
)
app.include_router(api_router)
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()

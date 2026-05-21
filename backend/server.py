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
# Plan limits: Basic = 3 codes max (1 device each), Unlimited = unlimited codes
BASIC_MAX_CODES = int(os.environ.get('BASIC_MAX_CODES', '3'))
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
    subscription_tier: Optional[str] = None  # "basic" | "unlimited" | None
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
    is_private: bool = True
    client_id: Optional[str] = None  # groups videos belonging to the same wedding
    client_name: Optional[str] = None
    created_at: datetime


class UnlockRequest(BaseModel):
    code: str
    device_id: Optional[str] = None
    device_label: Optional[str] = None


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
    tier: Optional[str] = "basic"  # "basic" (1,99€) or "unlimited" (2,30€)


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
        subscription_tier=u.get("subscription_tier"),
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
    token = create_jwt(u["id"])
    return TokenResponse(access_token=token, user=user_to_public(u))


@api_router.get("/auth/me", response_model=UserPublic)
async def me(current: dict = Depends(get_current_user)):
    return user_to_public(current)


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


# --- WEDDINGS (grouped by client_id) ---
def _group_by_wedding(videos: list[dict]) -> dict:
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
    return by_client


@api_router.get("/weddings/public")
async def list_public_weddings():
    """List of weddings (grouped from videos). Public — no full URLs."""
    videos = await db.videos.find({}, {"_id": 0}).to_list(500)
    grouped = _group_by_wedding(videos)
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
    grouped = _group_by_wedding(filtered)
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
    Each code is locked to ONE device (the first device that uses it).
    The same device can re-unlock with the code as many times as needed."""
    code = body.code.strip().upper()
    rec = await db.unlock_codes.find_one({"code": code, "is_active": True}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Code invalide")
    if rec.get("expires_at") and rec["expires_at"] < utcnow():
        raise HTTPException(status_code=410, detail="Code expiré")

    # DEVICE BINDING: 1 code = 1 device. First device that uses it wins.
    device_id = (body.device_id or "").strip()
    bound_device = rec.get("bound_device_id")

    if bound_device:
        if not device_id:
            raise HTTPException(status_code=403, detail="Ce code est verrouillé sur un appareil spécifique. Veuillez utiliser ce même appareil.")
        if bound_device != device_id:
            raise HTTPException(status_code=403, detail="Ce code est déjà utilisé sur un autre appareil. Un code = 1 seul appareil.")
    else:
        # First use: bind to this device (if provided)
        # Also respect max_uses for legacy codes (still useful for admin "limit by use count" model)
        if rec.get("max_uses") and rec.get("current_uses", 0) >= rec["max_uses"]:
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

    # Bind to device on first activation (or refresh activation timestamp if same device)
    if device_id:
        ip = (request.client.host if request.client else "") or ""
        ua = (request.headers.get("user-agent") or "")[:300]
        if not bound_device:
            await db.unlock_codes.update_one(
                {"code": code},
                {"$set": {
                    "bound_device_id": device_id,
                    "bound_device_label": body.device_label or "Appareil",
                    "bound_device_ip": ip,
                    "bound_device_ua": ua,
                    "bound_at": utcnow(),
                }, "$inc": {"current_uses": 1}},
            )
        else:
            # Same device re-unlocking — update last seen
            await db.unlock_codes.update_one(
                {"code": code},
                {"$set": {"last_seen_at": utcnow()}},
            )
    else:
        # No device id provided (legacy) — bump usage count
        await db.unlock_codes.update_one({"code": code}, {"$inc": {"current_uses": 1}})

    wedding_name = wedding_videos[0].get("client_name") or wedding_videos[0].get("title")
    # also return the full videos so client can play immediately
    full_videos = [video_to_public(v, include_full=True) for v in wedding_videos]
    return {
        "ok": True,
        "client_id": client_id,
        "client_name": wedding_name,
        "video_count": len(wedding_videos),
        "videos": full_videos,
    }


# --- CLIENT SELF-SERVICE CODES (premium owners can generate codes for their own wedding) ---
def code_to_public(c: dict) -> dict:
    expired = bool(c.get("expires_at") and c["expires_at"] < utcnow())
    return {
        "code": c["code"],
        "client_id": c.get("client_id"),
        "label": c.get("label"),
        "is_active": c.get("is_active", True) and not expired,
        "expired": expired,
        "current_uses": c.get("current_uses", 0),
        "max_uses": c.get("max_uses"),
        "bound_device_id": c.get("bound_device_id"),
        "bound_device_label": c.get("bound_device_label"),
        "bound_at": c.get("bound_at").isoformat() if c.get("bound_at") else None,
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
        "max_uses": 1,  # 1 device per code; max_uses kept for legacy display
        "current_uses": 0,
        "expires_at": None,
        "bound_device_id": None,
        "created_at": utcnow(),
    })
    return {"ok": True, "code": code, "client_id": current["client_id"]}


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
async def get_video(video_id: str, current: Optional[dict] = Depends(get_optional_user)):
    v = await db.videos.find_one({"id": video_id}, {"_id": 0})
    if not v:
        raise HTTPException(status_code=404, detail="Vidéo introuvable")
    # check if user has unlocked
    unlocked = False
    if current:
        u_doc = await db.user_unlocks.find_one({"user_id": current["id"], "video_id": video_id})
        unlocked = bool(u_doc) or bool(current.get("is_subscribed")) or bool(current.get("is_admin"))
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

        tier = (body.tier or "basic").lower()
        if tier not in ("basic", "unlimited"):
            tier = "basic"
        price_amount = STRIPE_PRICE_AMOUNT_UNLIMITED if tier == "unlimited" else STRIPE_PRICE_AMOUNT
        product_name = "CINÉMARIÉS — Premium Illimité" if tier == "unlimited" else "CINÉMARIÉS — Premium"

        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=customer_id,
            line_items=[{
                "price_data": {
                    "currency": STRIPE_PRICE_CURRENCY,
                    "product_data": {"name": product_name},
                    "recurring": {"interval": "month"},
                    "unit_amount": price_amount,
                },
                "quantity": 1,
            }],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"user_id": current["id"], "tier": tier},
        )
        await db.checkout_sessions.insert_one({
            "session_id": session.id,
            "user_id": current["id"],
            "tier": tier,
            "status": "pending",
            "created_at": utcnow(),
        })
        return {"url": session.url, "session_id": session.id, "tier": tier}
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
                await db.users.update_one({"id": current["id"]}, {"$set": {"is_subscribed": True}})
                # save subscription id for cancellation
                sub_id = s.get("subscription")
                if sub_id:
                    await db.users.update_one({"id": current["id"]}, {"$set": {"stripe_subscription_id": sub_id}})
        except Exception as e:
            logging.warning(f"Stripe retrieve error: {e}")
    u = await db.users.find_one({"id": current["id"]}, {"_id": 0})
    return {"is_subscribed": bool(u.get("is_subscribed"))}


@api_router.get("/billing/config")
async def billing_config():
    """Public config: returns publishable key and prices so the front-end can display info."""
    return {
        "publishable_key": STRIPE_PUBLISHABLE_KEY,
        "price_amount": STRIPE_PRICE_AMOUNT,
        "price_amount_unlimited": STRIPE_PRICE_AMOUNT_UNLIMITED,
        "price_currency": STRIPE_PRICE_CURRENCY,
        "basic_max_codes": BASIC_MAX_CODES,
        "configured": bool(STRIPE_API_KEY and STRIPE_API_KEY != "sk_test_emergent"),
    }


@api_router.post("/billing/cancel")
async def cancel_subscription(current: dict = Depends(get_current_user)):
    """Cancel the user's Stripe subscription (at the end of the current period)."""
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
    for u in users:
        out.append({
            "id": u["id"],
            "email": u["email"],
            "full_name": u.get("full_name", ""),
            "is_subscribed": u.get("is_subscribed", False),
            "is_admin": u.get("is_admin", False),
            "subscription_tier": u.get("subscription_tier"),
            "client_id": u.get("client_id"),
            "unlocks": counts.get(u["id"], 0),
            "created_at": u.get("created_at").isoformat() if u.get("created_at") else None,
        })
    return {"users": out}


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




@api_router.get("/uploads/{name:path}")
async def serve_upload(name: str, request: Request):
    """Serve uploaded files with HTTP Range support (required for Chromecast / video streaming)."""
    # Safety: prevent path traversal but allow nested folders (e.g. hosting_xxx/file.mp4)
    if ".." in name:
        raise HTTPException(status_code=400, detail="Nom invalide")
    path = UPLOAD_DIR / name
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="Fichier introuvable")

    # Guess content type by extension
    import mimetypes
    ctype, _ = mimetypes.guess_type(str(path))
    if not ctype:
        ctype = "application/octet-stream"

    file_size = path.stat().st_size
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
    await db.user_unlocks.create_index([("user_id", 1), ("video_id", 1)], unique=True)
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


# Include router
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

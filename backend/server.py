from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Header, Request, UploadFile, File, Form
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
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
STRIPE_PRICE_AMOUNT = int(os.environ.get('STRIPE_PRICE_AMOUNT', '199'))
STRIPE_PRICE_CURRENCY = os.environ.get('STRIPE_PRICE_CURRENCY', 'eur')
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


class UnlockCodeInfo(BaseModel):
    code: str
    video_id: str
    video_title: str


class CheckoutRequest(BaseModel):
    success_url: Optional[str] = None
    cancel_url: Optional[str] = None


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
    wedding["videos"] = [video_to_public(v, include_full=unlocked) for v in filtered]
    # sort videos by category preferring chronological wedding day order
    cat_order = {"À l'affiche": 0, "Cérémonies": 1, "Soirées": 2, "Best Of": 3}
    wedding["videos"].sort(key=lambda x: cat_order.get(x.get("category", ""), 99))
    return wedding


@api_router.post("/weddings/unlock")
async def unlock_wedding(body: UnlockRequest, current: Optional[dict] = Depends(get_optional_user)):
    """Enter a code to unlock an entire wedding. Works anonymously (no login required).
    If user is logged in, the unlock is persisted to their account."""
    code = body.code.strip().upper()
    rec = await db.unlock_codes.find_one({"code": code, "is_active": True}, {"_id": 0})
    if not rec:
        raise HTTPException(status_code=404, detail="Code invalide")
    if rec.get("expires_at") and rec["expires_at"] < utcnow():
        raise HTTPException(status_code=410, detail="Code expiré")
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
    video_ids = [u["video_id"] for u in unlocks]
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

        session = stripe.checkout.Session.create(
            mode="subscription",
            customer=customer_id,
            line_items=[{
                "price_data": {
                    "currency": STRIPE_PRICE_CURRENCY,
                    "product_data": {"name": "CINÉMARIÉS — Premium"},
                    "recurring": {"interval": "month"},
                    "unit_amount": STRIPE_PRICE_AMOUNT,
                },
                "quantity": 1,
            }],
            success_url=success_url,
            cancel_url=cancel_url,
            metadata={"user_id": current["id"]},
        )
        await db.checkout_sessions.insert_one({
            "session_id": session.id,
            "user_id": current["id"],
            "status": "pending",
            "created_at": utcnow(),
        })
        return {"url": session.url, "session_id": session.id}
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
        except Exception as e:
            logging.warning(f"Stripe retrieve error: {e}")
    u = await db.users.find_one({"id": current["id"]}, {"_id": 0})
    return {"is_subscribed": bool(u.get("is_subscribed"))}


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
    # enrich with video titles
    ids = list({c["video_id"] for c in codes})
    vids = await db.videos.find({"id": {"$in": ids}}, {"_id": 0, "id": 1, "title": 1}).to_list(2000)
    title_map = {v["id"]: v["title"] for v in vids}
    out = []
    for c in codes:
        expired = bool(c.get("expires_at") and c["expires_at"] < utcnow())
        out.append({
            "code": c["code"],
            "video_id": c["video_id"],
            "video_title": title_map.get(c["video_id"], "?"),
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
            "unlocks": counts.get(u["id"], 0),
            "created_at": u.get("created_at").isoformat() if u.get("created_at") else None,
        })
    return {"users": out}


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


@api_router.get("/uploads/{name}")
async def serve_upload(name: str):
    # safe name check (no path traversal)
    if "/" in name or ".." in name:
        raise HTTPException(status_code=400, detail="Nom invalide")
    path = UPLOAD_DIR / name
    if not path.exists():
        raise HTTPException(status_code=404, detail="Fichier introuvable")
    return FileResponse(str(path))


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

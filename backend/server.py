from fastapi import FastAPI, APIRouter, HTTPException, Depends, status, Header, Request
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
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

stripe.api_key = STRIPE_API_KEY

# Database
client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

app = FastAPI(title="Wedding Stream API")
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
    }


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
    return {"message": "Wedding Stream API", "status": "ok"}


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
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=503, detail="Stripe non configuré")
    # ensure customer
    customer_id = current.get("stripe_customer_id")
    if not customer_id:
        cust = stripe.Customer.create(email=current["email"], name=current.get("full_name", ""))
        customer_id = cust.id
        await db.users.update_one({"id": current["id"]}, {"$set": {"stripe_customer_id": customer_id}})

    success_url = body.success_url or f"{APP_PUBLIC_URL}/subscription?status=success"
    cancel_url = body.cancel_url or f"{APP_PUBLIC_URL}/subscription?status=cancel"

    session = stripe.checkout.Session.create(
        mode="subscription",
        customer=customer_id,
        line_items=[{
            "price_data": {
                "currency": STRIPE_PRICE_CURRENCY,
                "product_data": {"name": "Wedding Stream — Abonnement Premium"},
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

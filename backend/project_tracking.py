"""Project tracking module for CINÉMARIÉS.

Provides 9-step wedding video production tracking with email + SMS notifications.
Design cloned from creativindustry.com/suivi-projet.

Steps:
  1. Vidage des cartes mémoire
  2. Sauvegarde sur nos serveurs
  3. Tri et sélection
  4. Retouche / Montage
  5. Photos déposées sur votre espace
  6. Sélection des 40 photos
  7. Musique de mariage
  8. Vérification qualité
  9. Livraison

Notifications:
  - Email  : IONOS SMTP via mailer.send_email
  - SMS    : Brevo Transactional SMS (https://api.brevo.com/v3/transactionalSMS/send)

Data model (collection `project_tracking`):
{
  id: str,
  client_id: str,           # e.g. "hanifa-et-dali", unique
  wedding_name: str,        # display, e.g. "Hanifa & Dali"
  owner_user_id: str|null,  # user who claimed the wedding
  owner_email: str|null,
  owner_phone: str|null,    # E.164 for SMS
  steps: [{key, title, description, status, started_at, completed_at, notified_at}],
  current_step_index: int,
  progress_percent: int,
  admin_note: str,
  eta_delivery: str|null,   # ISO date
  created_at: datetime,
  updated_at: datetime,
}
"""
from __future__ import annotations

import os
import re
import uuid
import logging
import asyncio
from datetime import datetime, timezone
from typing import Optional, List

import httpx
from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from pydantic import BaseModel, Field

try:
    from mailer import send_email, render_email  # existing IONOS SMTP helper
except Exception:  # pragma: no cover
    send_email = None
    render_email = None

log = logging.getLogger("project_tracking")

# ---------------------------------------------------------------------------
# CONSTANTS
# ---------------------------------------------------------------------------
DEFAULT_STEPS = [
    {"key": "card_offload",      "title": "Vidage des cartes mémoire",         "description": "Transfert de vos fichiers en cours"},
    {"key": "server_backup",     "title": "Sauvegarde sur nos serveurs",       "description": "Vos fichiers sont sauvegardés en sécurité"},
    {"key": "sorting",           "title": "Tri et sélection",                  "description": "Sélection des meilleures prises"},
    {"key": "editing",           "title": "Retouche / Montage",                "description": "Édition et retouche en cours"},
    {"key": "photos_delivery",   "title": "Photos déposées sur votre espace",  "description": "Vos photos ont été déposées sur votre espace client"},
    {"key": "photo_selection",   "title": "Sélection des 40 photos",           "description": "Merci de nous retourner vos 40 photos préférées pour le montage"},
    {"key": "music",             "title": "Musique de mariage",                "description": "Envoyez-nous votre musique de mariage pour le montage"},
    {"key": "quality_check",     "title": "Vérification qualité",              "description": "Contrôle qualité final"},
    {"key": "delivery",          "title": "Livraison",                         "description": "Votre projet est prêt !"},
]

STATUS_PENDING = "pending"
STATUS_IN_PROGRESS = "in_progress"
STATUS_DONE = "done"

BREVO_API_URL = "https://api.brevo.com/v3/transactionalSMS/send"
APP_PUBLIC_URL = os.environ.get("APP_PUBLIC_URL", "https://cinemaries.fr")


# ---------------------------------------------------------------------------
# HELPERS
# ---------------------------------------------------------------------------
def _utcnow():
    return datetime.now(timezone.utc)


def _build_default_steps():
    """Return a fresh copy of the 9 pending steps."""
    return [
        {
            **s,
            "status": STATUS_PENDING,
            "started_at": None,
            "completed_at": None,
            "notified_at": None,
        }
        for s in DEFAULT_STEPS
    ]


def _compute_progress(steps: List[dict]) -> tuple[int, int]:
    """Return (current_step_index, progress_percent)."""
    done = sum(1 for s in steps if s.get("status") == STATUS_DONE)
    total = len(steps)
    percent = int(round(done / total * 100)) if total else 0
    # current = first non-done, or last if all done
    idx = next((i for i, s in enumerate(steps) if s.get("status") != STATUS_DONE), total - 1)
    return idx, percent


def normalize_fr_phone(raw: str | None) -> Optional[str]:
    """Convert FR phone to E.164 (+33...). Returns None if invalid/empty."""
    if not raw:
        return None
    digits = re.sub(r"[^0-9+]", "", str(raw))
    if digits.startswith("+"):
        # already international
        if re.match(r"^\+33[67]\d{8}$", digits):
            return digits
        # try +33 with formatted
        return digits if re.match(r"^\+\d{6,15}$", digits) else None
    # Local formats: 06XXXXXXXX or 07XXXXXXXX
    if re.match(r"^0[67]\d{8}$", digits):
        return "+33" + digits[1:]
    if re.match(r"^33[67]\d{8}$", digits):
        return "+" + digits
    return None


def sanitize_sms_content(text: str) -> str:
    """Keep SMS short & GSM-safe. Strip emojis and truncate."""
    # remove non-BMP chars (emojis)
    text = re.sub(r"[^\x00-\uFFFF]", "", text)
    # replace some accented chars are OK in GSM extended, but we avoid unicodeEnabled for cost
    # keep it under 160 GSM chars
    if len(text) > 160:
        text = text[:157].rstrip() + "..."
    return text


# ---------------------------------------------------------------------------
# NOTIFICATION SENDERS
# ---------------------------------------------------------------------------
# Module-level DB reference for reading dynamic settings from app_settings.
_db_ref = None


def bind_db(db):
    global _db_ref
    _db_ref = db


async def _get_brevo_settings() -> tuple[str, str]:
    """Return (api_key, sender) — DB first, env fallback."""
    if _db_ref is not None:
        try:
            from app_settings import get_brevo_sms_config
            cfg = await get_brevo_sms_config(_db_ref)
            return (cfg.get("api_key") or "").strip(), (cfg.get("sender") or "CINEMARIES").strip()
        except Exception as e:
            log.warning("[project_tracking] failed to read brevo DB config: %s", e)
    return (
        os.environ.get("BREVO_API_KEY", "").strip(),
        os.environ.get("BREVO_SMS_SENDER", "CINEMARIES").strip(),
    )


async def send_brevo_sms(recipient_e164: str, content: str, tag: str = "project_tracking") -> tuple[bool, str]:
    """Send a transactional SMS via Brevo. Returns (ok, messageId_or_error)."""
    api_key, sender = await _get_brevo_settings()
    if not api_key:
        return False, "brevo_api_key_missing"
    # Brevo sender: 11 chars max, alphanumeric
    sender = re.sub(r"[^A-Za-z0-9]", "", sender)[:11] or "CINEMARIES"
    payload = {
        "sender": sender,
        "recipient": recipient_e164,
        "content": sanitize_sms_content(content),
        "type": "transactional",
        "tag": tag,
        "unicodeEnabled": False,
    }
    headers = {
        "accept": "application/json",
        "api-key": api_key,
        "content-type": "application/json",
    }
    try:
        async with httpx.AsyncClient(timeout=15) as http:
            resp = await http.post(BREVO_API_URL, json=payload, headers=headers)
        if resp.status_code == 201:
            data = resp.json()
            log.info("[brevo] SMS sent to %s tag=%s messageId=%s", _mask_phone(recipient_e164), tag, data.get("messageId"))
            return True, str(data.get("messageId", ""))
        err_body = ""
        try:
            err_body = resp.text[:200]
        except Exception:
            pass
        log.warning("[brevo] SMS FAILED http=%s body=%s", resp.status_code, err_body)
        return False, f"http_{resp.status_code}"
    except Exception as e:
        log.error("[brevo] SMS exception: %s", e)
        return False, f"exception:{type(e).__name__}"


def _mask_phone(phone: str) -> str:
    if not phone or len(phone) < 6:
        return "***"
    return phone[:4] + "•••" + phone[-2:]


def _email_body_for_step(wedding_name: str, step: dict, admin_note: str = "") -> str:
    title = step["title"]
    desc = step["description"]
    note_html = ""
    if admin_note:
        note_html = f"""
        <div style="margin:16px 0;padding:12px 14px;background:#0A2A0A;border-left:3px solid #4ADE80;border-radius:4px">
          <div style="color:#9AE6B4;font-size:12px;font-weight:700;margin-bottom:4px;text-transform:uppercase;letter-spacing:0.5px">Message du studio</div>
          <div style="color:#E5E2D6;font-size:14px;line-height:1.5">{admin_note}</div>
        </div>
        """
    body = f"""
    <p>Bonjour,</p>
    <p>Votre film de mariage <strong>{wedding_name}</strong> avance :</p>
    <div style="margin:24px 0;padding:20px;background:#0A2A0A;border:1px solid #2E7D32;border-radius:8px">
      <div style="color:#4ADE80;font-size:20px;font-weight:700;margin-bottom:6px">✅ {title}</div>
      <div style="color:#9AE6B4;font-size:14px;line-height:1.5">{desc}</div>
    </div>
    {note_html}
    <p style="color:#9A9A9A;font-size:13px">Connectez-vous à votre espace privé pour suivre l'avancement complet de votre projet.</p>
    """
    if render_email is None:
        return body
    return render_email(
        title=f"Étape franchie : {title}",
        body_html=body,
        cta_label="Voir mon suivi de projet",
        cta_url=f"{APP_PUBLIC_URL}/profile",
    )


def _sms_body_for_step(wedding_name: str, step: dict, progress_pct: int) -> str:
    # Brevo SMS: keep <= 160 GSM chars, no accents, no emojis to keep cost low
    title = re.sub(r"[éèê]", "e", step["title"]).replace("à", "a").replace("â", "a")
    wed = re.sub(r"[éèê]", "e", wedding_name).replace("à", "a").replace("â", "a")
    body = f"CINEMARIES : {wed} - etape franchie : {title} ({progress_pct}%). Suivi : {APP_PUBLIC_URL}/profile"
    return sanitize_sms_content(body)


async def notify_step_change(project: dict, step: dict, background: bool = True):
    """Fire-and-forget notification (email + SMS)."""
    async def _do():
        try:
            wedding_name = project.get("wedding_name") or project.get("client_id") or "Votre mariage"
            _, progress = _compute_progress(project.get("steps", []))
            # Email
            email = project.get("owner_email")
            if email and send_email is not None:
                try:
                    html = _email_body_for_step(wedding_name, step, project.get("admin_note", ""))
                    subject = f"CINÉMARIÉS — {wedding_name} — {step['title']}"
                    await send_email(email, subject, html)
                except Exception as e:
                    log.warning("[project_tracking] email failed for %s: %s", email, e)
            # SMS
            phone_e164 = normalize_fr_phone(project.get("owner_phone"))
            if phone_e164:
                sms_body = _sms_body_for_step(wedding_name, step, progress)
                await send_brevo_sms(phone_e164, sms_body, tag=f"step:{step['key']}")
        except Exception as e:
            log.error("[project_tracking] notify error: %s", e)
    if background:
        asyncio.create_task(_do())
    else:
        await _do()


# ---------------------------------------------------------------------------
# API MODELS
# ---------------------------------------------------------------------------
class CreateProjectBody(BaseModel):
    client_id: str = Field(min_length=1, max_length=100)
    wedding_name: str = Field(min_length=1, max_length=200)
    owner_email: Optional[str] = None
    owner_phone: Optional[str] = None
    admin_note: Optional[str] = ""
    eta_delivery: Optional[str] = None


class UpdateProjectBody(BaseModel):
    wedding_name: Optional[str] = None
    owner_email: Optional[str] = None
    owner_phone: Optional[str] = None
    admin_note: Optional[str] = None
    eta_delivery: Optional[str] = None


class UpdateStepBody(BaseModel):
    status: str  # pending | in_progress | done
    notify: bool = True  # send email + SMS if transitioning to done or in_progress


class LinkUserBody(BaseModel):
    user_id: Optional[str] = None
    email: Optional[str] = None


class TestNotifyBody(BaseModel):
    channel: str = "sms"  # sms | email
    phone: Optional[str] = None
    email: Optional[str] = None
    message: Optional[str] = "CINEMARIES: test de notification depuis l'admin."


# ---------------------------------------------------------------------------
# ROUTER FACTORY
# ---------------------------------------------------------------------------
def register_project_tracking_routes(
    api_router: APIRouter,
    db,
    get_current_user,
    require_admin,
):
    """Attach project-tracking routes to the existing api_router."""

    async def _project_to_public(p: dict) -> dict:
        p = {k: v for k, v in p.items() if k != "_id"}
        idx, pct = _compute_progress(p.get("steps", []))
        p["current_step_index"] = idx
        p["progress_percent"] = pct
        return p

    async def _upsert_project(client_id: str, **fields) -> dict:
        """Ensure a project doc exists. Returns the doc."""
        existing = await db.project_tracking.find_one({"client_id": client_id})
        if existing:
            return existing
        doc = {
            "id": str(uuid.uuid4()),
            "client_id": client_id,
            "wedding_name": fields.get("wedding_name") or client_id.replace("-", " ").title(),
            "owner_user_id": fields.get("owner_user_id"),
            "owner_email": (fields.get("owner_email") or "").lower().strip() or None,
            "owner_phone": fields.get("owner_phone"),
            "admin_note": fields.get("admin_note", ""),
            "eta_delivery": fields.get("eta_delivery"),
            "steps": _build_default_steps(),
            "created_at": _utcnow(),
            "updated_at": _utcnow(),
        }
        await db.project_tracking.insert_one(doc)
        # Un suivi recréé ne doit plus être considéré comme supprimé
        await db.project_tracking_deleted.delete_one({"client_id": client_id})
        await _link_owner_user(client_id, doc.get("owner_email"))
        log.info("[project_tracking] created for client_id=%s", client_id)
        return doc

    async def _link_owner_user(client_id: str, owner_email: Optional[str]) -> Optional[dict]:
        """Relie automatiquement le compte « Mariés » dont l'email correspond à owner_email :
        users.client_id ← client_id et project.owner_user_id ← user.id (temps réel côté client)."""
        if not owner_email:
            return None
        u = await db.users.find_one({"email": owner_email.lower().strip()}, {"_id": 0, "id": 1, "client_id": 1, "is_admin": 1})
        if not u or u.get("is_admin"):
            return None
        if not u.get("client_id"):
            await db.users.update_one({"id": u["id"]}, {"$set": {"client_id": client_id}})
        await db.project_tracking.update_one({"client_id": client_id}, {"$set": {"owner_user_id": u["id"]}})
        log.info("[project_tracking] user %s linked to %s", owner_email, client_id)
        return u

    # -----------------------------
    # CLIENT SIDE
    # -----------------------------
    @api_router.get("/projects/me")
    async def get_my_project(current: dict = Depends(get_current_user)):
        """Return the tracking of the wedding the current user is linked to.

        The user is linked either:
        - directly, via `users.client_id` set by the admin, OR
        - via a claim record (users.claimed_client_id / wedding_claims collection)

        Admins get the first project as a preview (for admin testing).
        """
        # 1) Direct link on the user document (set by admin)
        wedding_id = current.get("client_id") or current.get("claimed_client_id")

        # 2) Fallback to the wedding_claims collection
        if not wedding_id:
            claim = await db.wedding_claims.find_one({"user_id": current["id"]}, {"_id": 0})
            if claim:
                wedding_id = claim.get("client_id")

        if not wedding_id:
            # Compte « Mariés » : tenter la liaison automatique par email (suivi créé par l'admin)
            if current.get("account_type") == "couple":
                p = await db.project_tracking.find_one({"owner_email": (current.get("email") or "").lower()}, {"_id": 0})
                if p:
                    await _link_owner_user(p["client_id"], current.get("email"))
                    return {"project": await _project_to_public(p)}
            # Admin preview: return the first project so admins can inspect the UI
            if current.get("is_admin"):
                p = await db.project_tracking.find_one({}, {"_id": 0})
                if not p:
                    return {"project": None, "hint": "Aucun projet en base. Créez-en un depuis l'admin."}
                return {"project": await _project_to_public(p), "admin_preview": True}
            return {"project": None, "account_type": current.get("account_type") or "user"}

        p = await db.project_tracking.find_one({"client_id": wedding_id})
        if not p:
            return {"project": None, "client_id": wedding_id}
        return {"project": await _project_to_public(p)}

    # -----------------------------
    # ADMIN SIDE
    # -----------------------------
    @api_router.get("/admin/projects")
    async def admin_list_projects(admin: dict = Depends(require_admin)):
        # Ensure a project exists for each claimed wedding (sauf suivis supprimés volontairement)
        deleted = {d["client_id"] async for d in db.project_tracking_deleted.find({}, {"client_id": 1})}
        claims = await db.wedding_claims.find({}, {"_id": 0, "client_id": 1, "client_name": 1, "user_id": 1}).to_list(500)
        for c in claims:
            if c["client_id"] in deleted:
                continue
            existing = await db.project_tracking.find_one({"client_id": c["client_id"]})
            if not existing:
                user = await db.users.find_one({"id": c["user_id"]}, {"email": 1, "phone": 1})
                await _upsert_project(
                    c["client_id"],
                    wedding_name=c.get("client_name") or c["client_id"],
                    owner_user_id=c["user_id"],
                    owner_email=(user or {}).get("email"),
                    owner_phone=(user or {}).get("phone"),
                )
        items = await db.project_tracking.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
        result = [await _project_to_public(p) for p in items]
        return {"items": result, "count": len(result)}

    @api_router.get("/admin/projects/{client_id}")
    async def admin_get_project(client_id: str, admin: dict = Depends(require_admin)):
        p = await db.project_tracking.find_one({"client_id": client_id})
        if not p:
            raise HTTPException(404, "Projet introuvable")
        return await _project_to_public(p)

    @api_router.post("/admin/projects")
    async def admin_create_project(body: CreateProjectBody, admin: dict = Depends(require_admin)):
        existing = await db.project_tracking.find_one({"client_id": body.client_id})
        if existing:
            raise HTTPException(409, f"Un projet existe déjà pour '{body.client_id}'")
        # try to link with a wedding_claim
        claim = await db.wedding_claims.find_one({"client_id": body.client_id})
        owner_user_id = claim["user_id"] if claim else None
        doc = await _upsert_project(
            body.client_id,
            wedding_name=body.wedding_name,
            owner_user_id=owner_user_id,
            owner_email=body.owner_email,
            owner_phone=body.owner_phone,
            admin_note=body.admin_note or "",
            eta_delivery=body.eta_delivery,
        )
        return await _project_to_public(doc)

    @api_router.patch("/admin/projects/{client_id}")
    async def admin_update_project(client_id: str, body: UpdateProjectBody, admin: dict = Depends(require_admin)):
        p = await db.project_tracking.find_one({"client_id": client_id})
        if not p:
            raise HTTPException(404, "Projet introuvable")
        update = {"updated_at": _utcnow()}
        for k in ("wedding_name", "owner_email", "owner_phone", "admin_note", "eta_delivery"):
            v = getattr(body, k)
            if v is not None:
                update[k] = v.lower().strip() if k == "owner_email" else v
        await db.project_tracking.update_one({"client_id": client_id}, {"$set": update})
        if update.get("owner_email"):
            await _link_owner_user(client_id, update["owner_email"])
        p2 = await db.project_tracking.find_one({"client_id": client_id})
        return await _project_to_public(p2)

    @api_router.patch("/admin/projects/{client_id}/steps/{step_key}")
    async def admin_update_step(
        client_id: str,
        step_key: str,
        body: UpdateStepBody,
        admin: dict = Depends(require_admin),
    ):
        if body.status not in (STATUS_PENDING, STATUS_IN_PROGRESS, STATUS_DONE):
            raise HTTPException(400, "Status invalide")
        p = await db.project_tracking.find_one({"client_id": client_id})
        if not p:
            raise HTTPException(404, "Projet introuvable")
        steps = p.get("steps") or _build_default_steps()
        target = None
        for s in steps:
            if s["key"] == step_key:
                target = s
                break
        if not target:
            raise HTTPException(404, f"Étape inconnue: {step_key}")

        old_status = target.get("status", STATUS_PENDING)
        target["status"] = body.status
        now = _utcnow()
        if body.status == STATUS_IN_PROGRESS and old_status == STATUS_PENDING:
            target["started_at"] = now
        if body.status == STATUS_DONE:
            if not target.get("started_at"):
                target["started_at"] = now
            target["completed_at"] = now
        if body.status == STATUS_PENDING:
            target["started_at"] = None
            target["completed_at"] = None

        await db.project_tracking.update_one(
            {"client_id": client_id},
            {"$set": {"steps": steps, "updated_at": now}}
        )
        p2 = await db.project_tracking.find_one({"client_id": client_id})

        # Notify only when transitioning INTO in_progress or done (not on pending)
        should_notify = body.notify and body.status in (STATUS_IN_PROGRESS, STATUS_DONE) and old_status != body.status
        if should_notify:
            target["notified_at"] = now
            await db.project_tracking.update_one(
                {"client_id": client_id, "steps.key": step_key},
                {"$set": {"steps.$.notified_at": now}}
            )
            await notify_step_change(p2, target, background=True)

        return await _project_to_public(p2)

    @api_router.post("/admin/projects/{client_id}/test-notify")
    async def admin_test_notify(client_id: str, body: TestNotifyBody, admin: dict = Depends(require_admin)):
        """Send a test notification via chosen channel."""
        p = await db.project_tracking.find_one({"client_id": client_id})
        if not p:
            raise HTTPException(404, "Projet introuvable")
        if body.channel == "sms":
            phone_raw = body.phone or p.get("owner_phone")
            phone_e164 = normalize_fr_phone(phone_raw)
            if not phone_e164:
                raise HTTPException(400, "Numéro FR invalide (format 06XXXXXXXX ou +336XXXXXXXX)")
            ok, info = await send_brevo_sms(phone_e164, body.message or "Test CINEMARIES", tag="test")
            return {"ok": ok, "info": info, "phone": _mask_phone(phone_e164)}
        elif body.channel == "email":
            email = body.email or p.get("owner_email")
            if not email:
                raise HTTPException(400, "Email manquant")
            if send_email is None:
                raise HTTPException(503, "Mailer non disponible")
            wedding_name = p.get("wedding_name", "Votre mariage")
            html = render_email(
                title="Test de notification",
                body_html=f"<p>Ceci est un test de notification depuis l'admin CINÉMARIÉS.</p><p>Projet : <strong>{wedding_name}</strong></p><p>{body.message}</p>",
                cta_label="Ouvrir mon espace",
                cta_url=f"{APP_PUBLIC_URL}/profile",
            ) if render_email else f"<p>{body.message}</p>"
            ok = await send_email(email, "CINÉMARIÉS — Test de notification", html)
            return {"ok": ok, "email": email}
        raise HTTPException(400, "Channel invalide (sms|email)")

    @api_router.delete("/admin/projects/{client_id}")
    async def admin_delete_project(client_id: str, admin: dict = Depends(require_admin)):
        r = await db.project_tracking.delete_one({"client_id": client_id})
        if r.deleted_count == 0:
            raise HTTPException(404, "Projet introuvable")
        # Mémoriser la suppression pour que la liste ne recrée pas le suivi automatiquement
        await db.project_tracking_deleted.update_one(
            {"client_id": client_id}, {"$set": {"client_id": client_id, "deleted_at": _utcnow()}}, upsert=True
        )
        return {"deleted": True}

    @api_router.post("/admin/projects/{client_id}/link-user")
    async def admin_link_user(client_id: str, body: LinkUserBody, admin: dict = Depends(require_admin)):
        """Relie manuellement un compte (par id ou email) au suivi : le client voit alors son suivi en se connectant."""
        p = await db.project_tracking.find_one({"client_id": client_id})
        if not p:
            raise HTTPException(404, "Projet introuvable")
        q = {"id": body.user_id} if body.user_id else {"email": (body.email or "").lower().strip()}
        u = await db.users.find_one(q, {"_id": 0, "id": 1, "email": 1})
        if not u:
            raise HTTPException(404, "Aucun compte trouvé avec cet email / identifiant")
        await db.users.update_one({"id": u["id"]}, {"$set": {"client_id": client_id, "account_type": "couple"}})
        await db.project_tracking.update_one(
            {"client_id": client_id}, {"$set": {"owner_user_id": u["id"], "owner_email": u["email"], "updated_at": _utcnow()}}
        )
        p2 = await db.project_tracking.find_one({"client_id": client_id})
        return await _project_to_public(p2)

    # -----------------------------
    # Helper for admin: list wedding client_ids that could be tracked
    # -----------------------------
    @api_router.get("/admin/projects-candidates")
    async def admin_projects_candidates(admin: dict = Depends(require_admin)):
        """Return distinct client_ids from unlock_codes/videos/wedding_claims that
        do NOT yet have a project_tracking doc. Useful for the admin to create
        projects for existing weddings."""
        existing = set()
        async for p in db.project_tracking.find({}, {"client_id": 1}):
            existing.add(p["client_id"])

        candidates = {}

        async for c in db.wedding_claims.find({}, {"client_id": 1, "client_name": 1, "user_id": 1}):
            cid = c.get("client_id")
            if cid and cid not in existing and cid not in candidates:
                u = await db.users.find_one({"id": c.get("user_id")}, {"email": 1, "phone": 1, "full_name": 1})
                candidates[cid] = {
                    "client_id": cid,
                    "wedding_name": c.get("client_name") or cid,
                    "owner_user_id": c.get("user_id"),
                    "owner_email": (u or {}).get("email"),
                    "owner_phone": (u or {}).get("phone"),
                    "source": "claim",
                }
        async for code in db.unlock_codes.find({}, {"client_id": 1}):
            cid = code.get("client_id")
            if cid and cid not in existing and cid not in candidates:
                candidates[cid] = {
                    "client_id": cid,
                    "wedding_name": cid.replace("-", " ").title(),
                    "source": "unlock_code",
                }
        async for v in db.videos.find({"client_id": {"$exists": True, "$ne": None}}, {"client_id": 1, "title": 1, "client_name": 1}):
            cid = v.get("client_id")
            if cid and cid not in existing and cid not in candidates:
                candidates[cid] = {
                    "client_id": cid,
                    "wedding_name": v.get("client_name") or v.get("title") or cid.replace("-", " ").title(),
                    "source": "video",
                }

        # NEW: registered users with a wedding directly linked (client_id set by admin)
        # This is the main source now — we want couples who created an account.
        async for u in db.users.find(
            {
                "$or": [
                    {"client_id": {"$exists": True, "$ne": None, "$ne": ""}},
                    {"claimed_client_id": {"$exists": True, "$ne": None, "$ne": ""}},
                ]
            },
            {"email": 1, "phone": 1, "full_name": 1, "client_id": 1, "claimed_client_id": 1, "claimed_client_name": 1, "id": 1},
        ):
            cid = u.get("client_id") or u.get("claimed_client_id")
            if not cid or cid in existing:
                continue
            # Prefer nicer name : claimed_client_name > full_name > from client_id
            prev = candidates.get(cid) or {}
            name = u.get("claimed_client_name") or prev.get("wedding_name") or u.get("full_name") or cid.replace("-", " ").title()
            entry = {
                "client_id": cid,
                "wedding_name": name,
                "owner_user_id": u.get("id"),
                "owner_email": u.get("email"),
                "owner_phone": u.get("phone"),
                "source": "registered_user",
            }
            # Registered users take priority over anonymous sources (codes/videos)
            candidates[cid] = entry

        return {"items": list(candidates.values())}

    log.info("[project_tracking] routes registered")

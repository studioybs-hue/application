"""Digital Guestbook module for CINÉMARIÉS.

Guests scan a QR code at the wedding → land on /guestbook/{client_id} →
leave a text/audio/video message. Couple views everything privately via
their unlock code as a post-wedding surprise.

Storage:
    - Metadata in `guestbook_entries` collection
    - Audio/video files in /srv/cinemaries/uploads/guestbook/{client_id}/

Limits:
    - Max 60s audio, 30s video (frontend-enforced, backend size check)
    - Max upload size: 25 MB
    - Rate limit: 5 entries per IP per hour
    - Text max 1000 chars, guest_name max 60 chars
"""
from __future__ import annotations

import io
import os
import re
import uuid
import time
import hashlib
import logging
from pathlib import Path
from datetime import datetime, timezone, timedelta
from typing import Optional

import qrcode
from qrcode.constants import ERROR_CORRECT_M
from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Form, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

log = logging.getLogger("guestbook")

MAX_FILE_MB = 25
MAX_FILE_BYTES = MAX_FILE_MB * 1024 * 1024
MAX_TEXT = 1000
MAX_NAME = 60
RATE_LIMIT_PER_IP_PER_HOUR = 5
STATUS_PUBLISHED = "published"
STATUS_HIDDEN = "hidden"

ALLOWED_AUDIO_EXT = {"webm", "mp3", "m4a", "mp4", "wav", "ogg", "aac"}
ALLOWED_VIDEO_EXT = {"webm", "mp4", "mov", "m4v"}


def _utcnow():
    return datetime.now(timezone.utc)


def _ip_hash(ip: str) -> str:
    return hashlib.sha256(f"guestbook:{ip}".encode()).hexdigest()[:16]


def _ext_from_name(name: str) -> str:
    if "." not in name:
        return "bin"
    return name.rsplit(".", 1)[-1].lower()


class EntryCreate(BaseModel):
    guest_name: Optional[str] = Field(default=None, max_length=MAX_NAME)
    message_text: Optional[str] = Field(default=None, max_length=MAX_TEXT)
    media_type: Optional[str] = None  # "audio" | "video" | None
    media_url: Optional[str] = None    # returned by upload endpoint


def _to_public(e: dict) -> dict:
    return {
        "id": e["id"],
        "guest_name": (e.get("guest_name") or "").strip() or "Un invité",
        "message_text": e.get("message_text") or "",
        "media_type": e.get("media_type"),
        "media_url": e.get("media_url"),
        "status": e.get("status", STATUS_PUBLISHED),
        "created_at": e.get("created_at").isoformat() if e.get("created_at") else None,
    }


def register_guestbook_routes(
    api_router: APIRouter,
    db,
    UPLOAD_DIR: str,
    require_admin,
    send_sms_fn=None,
):
    """Attach guestbook routes."""

    GB_UPLOAD_DIR = Path(UPLOAD_DIR) / "guestbook"
    GB_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

    # -------------------------------------------------------------------
    # Helpers
    # -------------------------------------------------------------------
    async def _wedding_info(client_id: str) -> dict:
        """Return {wedding_name, exists} for the given client_id."""
        p = await db.project_tracking.find_one({"client_id": client_id}, {"wedding_name": 1, "owner_phone": 1})
        if p:
            return {"wedding_name": p.get("wedding_name") or client_id, "owner_phone": p.get("owner_phone")}
        # Fallback : look in videos or unlock_codes
        v = await db.videos.find_one({"client_id": client_id}, {"title": 1})
        if v:
            return {"wedding_name": v.get("title") or client_id, "owner_phone": None}
        # Any unlock_code proves the wedding exists
        c = await db.unlock_codes.find_one({"client_id": client_id})
        if c:
            return {"wedding_name": client_id.replace("-", " ").title(), "owner_phone": None}
        return {}

    async def _rate_limit_check(client_id: str, ip: str):
        cutoff = _utcnow() - timedelta(hours=1)
        n = await db.guestbook_entries.count_documents({
            "client_id": client_id,
            "ip_hash": _ip_hash(ip),
            "created_at": {"$gte": cutoff},
        })
        if n >= RATE_LIMIT_PER_IP_PER_HOUR:
            raise HTTPException(429, f"Trop de messages, réessayez dans 1h (limite: {RATE_LIMIT_PER_IP_PER_HOUR}/h)")

    # -------------------------------------------------------------------
    # PUBLIC — guest side
    # -------------------------------------------------------------------
    @api_router.get("/guestbook/{client_id}/info")
    async def get_wedding_info(client_id: str):
        info = await _wedding_info(client_id)
        if not info:
            raise HTTPException(404, "Mariage introuvable")
        # count public messages
        count = await db.guestbook_entries.count_documents({
            "client_id": client_id,
            "status": STATUS_PUBLISHED,
        })
        return {
            "client_id": client_id,
            "wedding_name": info["wedding_name"],
            "message_count": count,
        }

    @api_router.post("/guestbook/{client_id}/upload")
    async def upload_media(
        client_id: str,
        request: Request,
        file: UploadFile = File(...),
        media_type: str = Form(...),
    ):
        info = await _wedding_info(client_id)
        if not info:
            raise HTTPException(404, "Mariage introuvable")

        client_ip = (request.headers.get("x-forwarded-for") or request.client.host or "").split(",")[0].strip()
        await _rate_limit_check(client_id, client_ip)

        if media_type not in ("audio", "video"):
            raise HTTPException(400, "media_type doit être audio ou video")
        ext = _ext_from_name(file.filename or "")
        allowed = ALLOWED_AUDIO_EXT if media_type == "audio" else ALLOWED_VIDEO_EXT
        if ext not in allowed:
            raise HTTPException(400, f"Extension non autorisée: .{ext}")

        # Read & size-check
        content = await file.read()
        if len(content) > MAX_FILE_BYTES:
            raise HTTPException(413, f"Fichier trop lourd (max {MAX_FILE_MB} Mo)")

        # Save
        safe_id = re.sub(r"[^a-zA-Z0-9\-_]", "_", client_id)
        subdir = GB_UPLOAD_DIR / safe_id
        subdir.mkdir(parents=True, exist_ok=True)
        fname = f"{uuid.uuid4().hex}.{ext}"
        fpath = subdir / fname
        fpath.write_bytes(content)
        url = f"/api/uploads/guestbook/{safe_id}/{fname}"
        log.info("[guestbook] uploaded %s bytes for %s → %s", len(content), client_id, url)
        return {"url": url, "size_bytes": len(content)}

    @api_router.post("/guestbook/{client_id}/entries")
    async def create_entry(client_id: str, body: EntryCreate, request: Request):
        info = await _wedding_info(client_id)
        if not info:
            raise HTTPException(404, "Mariage introuvable")

        text = (body.message_text or "").strip()[:MAX_TEXT]
        guest_name = (body.guest_name or "").strip()[:MAX_NAME]

        if not text and not body.media_url:
            raise HTTPException(400, "Un message texte ou audio/vidéo est requis")

        client_ip = (request.headers.get("x-forwarded-for") or (request.client and request.client.host) or "").split(",")[0].strip()
        await _rate_limit_check(client_id, client_ip)

        entry = {
            "id": str(uuid.uuid4()),
            "client_id": client_id,
            "wedding_name": info["wedding_name"],
            "guest_name": guest_name,
            "message_text": text,
            "media_type": body.media_type if body.media_type in ("audio", "video") else None,
            "media_url": body.media_url,
            "status": STATUS_PUBLISHED,
            "ip_hash": _ip_hash(client_ip),
            "created_at": _utcnow(),
        }
        await db.guestbook_entries.insert_one(entry)
        log.info("[guestbook] new entry for %s from %s (media=%s)", client_id, guest_name or "?", body.media_type)

        # SMS notification to couple
        if info.get("owner_phone") and send_sms_fn is not None:
            try:
                from project_tracking import normalize_fr_phone, sanitize_sms_content
                e164 = normalize_fr_phone(info["owner_phone"])
                if e164:
                    who = guest_name or "Un invité"
                    ico = "video" if body.media_type == "video" else ("audio" if body.media_type == "audio" else "message")
                    sms = f"CINEMARIES: {who} vient de laisser un {ico} pour votre livre d'or ! Total: {(await db.guestbook_entries.count_documents({'client_id': client_id, 'status': STATUS_PUBLISHED}))} messages."
                    import asyncio as _asyncio
                    _asyncio.create_task(send_sms_fn(e164, sanitize_sms_content(sms), "guestbook_new"))
            except Exception as e:
                log.warning("[guestbook] SMS notify failed: %s", e)

        return _to_public(entry)

    @api_router.get("/guestbook/{client_id}/entries")
    async def list_entries_public(client_id: str, code: Optional[str] = None):
        """Public list — requires unlock code for the wedding (couple's surprise view)."""
        info = await _wedding_info(client_id)
        if not info:
            raise HTTPException(404, "Mariage introuvable")
        if not code:
            raise HTTPException(403, "Code d'accès requis")
        # Verify code
        c = await db.unlock_codes.find_one({"code": code.strip().upper(), "client_id": client_id})
        if not c:
            raise HTTPException(403, "Code invalide pour ce mariage")
        items = await db.guestbook_entries.find(
            {"client_id": client_id, "status": STATUS_PUBLISHED}
        ).sort("created_at", -1).to_list(500)
        return {"items": [_to_public(e) for e in items], "count": len(items), "wedding_name": info["wedding_name"]}

    # -------------------------------------------------------------------
    # ADMIN
    # -------------------------------------------------------------------
    @api_router.get("/admin/guestbook")
    async def admin_list_all(admin: dict = Depends(require_admin)):
        # aggregate: count per client_id
        pipeline = [
            {"$group": {
                "_id": "$client_id",
                "wedding_name": {"$first": "$wedding_name"},
                "total": {"$sum": 1},
                "published": {"$sum": {"$cond": [{"$eq": ["$status", "published"]}, 1, 0]}},
                "hidden": {"$sum": {"$cond": [{"$eq": ["$status", "hidden"]}, 1, 0]}},
                "last_at": {"$max": "$created_at"},
            }},
            {"$sort": {"last_at": -1}},
        ]
        rows = await db.guestbook_entries.aggregate(pipeline).to_list(500)
        return {"items": [
            {
                "client_id": r["_id"],
                "wedding_name": r.get("wedding_name") or r["_id"],
                "total": r["total"],
                "published": r["published"],
                "hidden": r["hidden"],
                "last_at": r["last_at"].isoformat() if r.get("last_at") else None,
            } for r in rows
        ]}

    @api_router.get("/admin/guestbook/{client_id}")
    async def admin_list_by_wedding(client_id: str, admin: dict = Depends(require_admin)):
        info = await _wedding_info(client_id)
        if not info:
            raise HTTPException(404, "Mariage introuvable")
        items = await db.guestbook_entries.find({"client_id": client_id}).sort("created_at", -1).to_list(500)
        return {
            "wedding_name": info["wedding_name"],
            "client_id": client_id,
            "items": [_to_public(e) for e in items],
        }

    @api_router.patch("/admin/guestbook/{entry_id}")
    async def admin_moderate(entry_id: str, admin: dict = Depends(require_admin)):
        body = {"status": STATUS_HIDDEN}  # simple toggle: default hide
        e = await db.guestbook_entries.find_one({"id": entry_id})
        if not e:
            raise HTTPException(404, "Message introuvable")
        new_status = STATUS_PUBLISHED if e.get("status") == STATUS_HIDDEN else STATUS_HIDDEN
        await db.guestbook_entries.update_one({"id": entry_id}, {"$set": {"status": new_status}})
        return {"id": entry_id, "status": new_status}

    @api_router.delete("/admin/guestbook/{entry_id}")
    async def admin_delete(entry_id: str, admin: dict = Depends(require_admin)):
        e = await db.guestbook_entries.find_one({"id": entry_id})
        if not e:
            raise HTTPException(404, "Message introuvable")
        # Delete media file if any
        if e.get("media_url"):
            m = re.search(r"/uploads/guestbook/([^/]+)/([^/]+)$", e["media_url"])
            if m:
                fpath = GB_UPLOAD_DIR / m.group(1) / m.group(2)
                try:
                    fpath.unlink()
                except Exception:
                    pass
        await db.guestbook_entries.delete_one({"id": entry_id})
        return {"deleted": True}

    @api_router.get("/admin/guestbook/{client_id}/qr")
    async def admin_qr(client_id: str, admin: dict = Depends(require_admin)):
        info = await _wedding_info(client_id)
        if not info:
            raise HTTPException(404, "Mariage introuvable")
        public_url = os.environ.get("APP_PUBLIC_URL", "https://cinemaries.fr")
        url = f"{public_url}/guestbook/{client_id}"
        qr = qrcode.QRCode(
            version=None,
            error_correction=ERROR_CORRECT_M,
            box_size=10,
            border=2,
        )
        qr.add_data(url)
        qr.make(fit=True)
        img = qr.make_image(fill_color="#0A0A0A", back_color="#FFFFF0")
        buf = io.BytesIO()
        img.save(buf, format="PNG")
        buf.seek(0)
        return StreamingResponse(
            buf,
            media_type="image/png",
            headers={"Content-Disposition": f'inline; filename="qr-{client_id}.png"',
                     "X-Guestbook-Url": url},
        )

    log.info("[guestbook] routes registered")

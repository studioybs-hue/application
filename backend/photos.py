"""
CINÉMARIÉS — Module Galerie Photo Premium
==========================================
Endpoints pour la gestion des photos de mariage (Insta-style),
le téléchargement individuel/ZIP, la musique de diaporama et
les favoris utilisateur.

Fonctionnement :
  - Le studio upload des JPEG dans /srv/cinemaries/uploads/photos/{wedding_id}/originals/
  - Admin clique "Scanner" → backend génère vignettes 400×400 + entrées DB
  - Le couple Premium accède à la galerie (grille 3 colonnes)
  - Téléchargement individuel ou ZIP (50 photos max)
  - Diaporama avec musique uploadée par le studio
"""

import io
import os
import uuid
import zipfile
import asyncio
from pathlib import Path
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, HTTPException, Depends, UploadFile, File, Query
from fastapi.responses import StreamingResponse, FileResponse
from pydantic import BaseModel

# Pillow pour la génération des vignettes
try:
    from PIL import Image, ImageOps
    PILLOW_AVAILABLE = True
except ImportError:
    PILLOW_AVAILABLE = False

# ---- Configuration ----
PHOTOS_PER_WEDDING_MAX = 100  # marge de sécurité (utilisateur a dit 50)
THUMB_SIZE = (400, 400)
ALLOWED_PHOTO_EXTS = {'.jpg', '.jpeg', '.png', '.webp'}
ALLOWED_MUSIC_EXTS = {'.mp3', '.m4a', '.aac', '.wav'}
ZIP_MAX_PHOTOS = 100


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ====== HELPERS ======

def wedding_photos_dir(uploads_root: Path, wedding_id: str) -> Path:
    """Returns the base folder for a wedding's photos."""
    return uploads_root / "photos" / wedding_id


def ensure_photos_dirs(uploads_root: Path, wedding_id: str) -> dict:
    """Ensures originals/ and thumbs/ folders exist for a wedding."""
    base = wedding_photos_dir(uploads_root, wedding_id)
    originals = base / "originals"
    thumbs = base / "thumbs"
    originals.mkdir(parents=True, exist_ok=True)
    thumbs.mkdir(parents=True, exist_ok=True)
    return {"base": base, "originals": originals, "thumbs": thumbs}


def generate_thumbnail(src_path: Path, dst_path: Path, size=THUMB_SIZE) -> dict:
    """Crée une vignette JPEG centrée (square crop). Retourne {width, height}."""
    if not PILLOW_AVAILABLE:
        raise RuntimeError("Pillow n'est pas installé. Lancez: pip install Pillow")
    with Image.open(src_path) as img:
        # Conversion en RGB si nécessaire (PNG transparent, etc.)
        if img.mode in ("RGBA", "P", "LA"):
            background = Image.new("RGB", img.size, (10, 10, 10))
            if img.mode == "RGBA" or img.mode == "LA":
                background.paste(img, mask=img.split()[-1])
            else:
                background.paste(img.convert("RGBA"), mask=img.convert("RGBA").split()[-1])
            img = background
        elif img.mode != "RGB":
            img = img.convert("RGB")
        # EXIF orientation correction
        img = ImageOps.exif_transpose(img)
        orig_width, orig_height = img.size
        # Crop carré centré puis resize
        thumb = ImageOps.fit(img, size, Image.Resampling.LANCZOS, centering=(0.5, 0.5))
        thumb.save(dst_path, "JPEG", quality=82, optimize=True)
        return {"width": orig_width, "height": orig_height}


# ====== MODELS ======

class PhotoOut(BaseModel):
    id: str
    wedding_id: str
    filename: str
    thumb_url: str
    full_url: str
    width: Optional[int] = None
    height: Optional[int] = None
    size_bytes: Optional[int] = None
    order: int = 0
    is_favorite: bool = False
    created_at: Optional[datetime] = None


class PhotosInfo(BaseModel):
    wedding_id: str
    photos_count: int
    music_url: Optional[str] = None
    storage_bytes: int = 0
    has_access: bool = False
    access_reason: Optional[str] = None  # "premium_required", "code_locked", "ok"


# ====== AUTHORIZATION ======

async def _user_can_view_photos(db, user: Optional[dict], wedding_id: str) -> tuple[bool, str]:
    """
    Retourne (allowed, reason).
    - Admin : toujours OK
    - Utilisateur abonné Premium : OK si le mariage existe
    - Sinon : "premium_required"
    """
    if not user:
        return False, "not_authenticated"
    if user.get("is_admin"):
        return True, "admin"
    # Vérifier que le mariage existe (au moins une vidéo avec ce client_id)
    has_wedding = await db.videos.find_one({"client_id": wedding_id})
    if not has_wedding:
        return False, "wedding_not_found"
    if not user.get("is_subscribed"):
        return False, "premium_required"
    return True, "ok"


async def _wedding_exists(db, wedding_id: str) -> bool:
    """Check if a wedding exists by looking for at least one video with this client_id."""
    return bool(await db.videos.find_one({"client_id": wedding_id}))


async def _get_wedding_settings(db, wedding_id: str) -> dict:
    """Get or initialize wedding settings (photo gallery metadata)."""
    s = await db.wedding_settings.find_one({"wedding_id": wedding_id})
    return s or {}


# ====== ROUTER REGISTRATION ======

def register_photo_routes(
    api_router: APIRouter,
    db,
    UPLOAD_DIR: Path,
    get_current_user,
    require_admin,
):
    """Attach all /photos endpoints to the given api_router."""

    # ----- Premium gate (utility endpoint) -----
    @api_router.get("/weddings/{wedding_id}/photos/info", response_model=PhotosInfo)
    async def photos_info(wedding_id: str, current: dict = Depends(get_current_user)):
        """Récupère le nombre de photos, l'URL de la musique et le statut d'accès."""
        if not await _wedding_exists(db, wedding_id):
            raise HTTPException(status_code=404, detail="Mariage introuvable")
        settings = await _get_wedding_settings(db, wedding_id)
        count = await db.wedding_photos.count_documents({"wedding_id": wedding_id})
        music_filename = settings.get("music_filename")
        music_url = f"/api/uploads/photos/{wedding_id}/{music_filename}" if music_filename else None
        # Calcul approximatif du stockage
        cursor = db.wedding_photos.find({"wedding_id": wedding_id}, {"size_bytes": 1})
        storage = 0
        async for p in cursor:
            storage += p.get("size_bytes", 0) or 0
        allowed, reason = await _user_can_view_photos(db, current, wedding_id)
        return PhotosInfo(
            wedding_id=wedding_id,
            photos_count=count,
            music_url=music_url,
            storage_bytes=storage,
            has_access=allowed,
            access_reason=reason,
        )

    # ----- List photos (paginated) -----
    @api_router.get("/weddings/{wedding_id}/photos", response_model=List[PhotoOut])
    async def list_photos(
        wedding_id: str,
        page: int = Query(1, ge=1),
        per_page: int = Query(50, ge=1, le=100),
        current: dict = Depends(get_current_user),
    ):
        """Liste les photos avec pagination. Premium requis pour non-admin."""
        allowed, reason = await _user_can_view_photos(db, current, wedding_id)
        if not allowed:
            raise HTTPException(status_code=402, detail=reason)
        skip = (page - 1) * per_page
        # Récupérer les favoris de l'utilisateur
        fav_ids: set = set()
        if current:
            async for f in db.photo_favorites.find({
                "user_id": current["id"],
                "wedding_id": wedding_id,
            }, {"photo_id": 1}):
                fav_ids.add(f["photo_id"])
        photos = []
        cursor = db.wedding_photos.find({"wedding_id": wedding_id}).sort([("order", 1), ("created_at", 1)]).skip(skip).limit(per_page)
        async for p in cursor:
            filename = p["filename"]
            photos.append(PhotoOut(
                id=p["id"],
                wedding_id=wedding_id,
                filename=filename,
                thumb_url=f"/api/uploads/photos/{wedding_id}/thumbs/{filename}",
                full_url=f"/api/uploads/photos/{wedding_id}/originals/{filename}",
                width=p.get("width"),
                height=p.get("height"),
                size_bytes=p.get("size_bytes"),
                order=p.get("order", 0),
                is_favorite=p["id"] in fav_ids,
                created_at=p.get("created_at"),
            ))
        return photos

    # ----- Toggle favorite -----
    @api_router.post("/weddings/{wedding_id}/photos/{photo_id}/favorite")
    async def toggle_favorite(
        wedding_id: str,
        photo_id: str,
        current: dict = Depends(get_current_user),
    ):
        if not current:
            raise HTTPException(status_code=401, detail="Connexion requise")
        existing = await db.photo_favorites.find_one({
            "user_id": current["id"],
            "photo_id": photo_id,
        })
        if existing:
            await db.photo_favorites.delete_one({"_id": existing["_id"]})
            return {"is_favorite": False}
        await db.photo_favorites.insert_one({
            "user_id": current["id"],
            "wedding_id": wedding_id,
            "photo_id": photo_id,
            "created_at": utcnow(),
        })
        return {"is_favorite": True}

    # ----- Download ZIP (multi) or single photo -----
    @api_router.get("/weddings/{wedding_id}/photos/download")
    async def download_photos(
        wedding_id: str,
        ids: Optional[str] = Query(None, description="Comma-separated photo IDs, or 'all'"),
        current: dict = Depends(get_current_user),
    ):
        allowed, reason = await _user_can_view_photos(db, current, wedding_id)
        if not allowed:
            raise HTTPException(status_code=402, detail=reason)
        if not await _wedding_exists(db, wedding_id):
            raise HTTPException(status_code=404, detail="Mariage introuvable")
        # Résoudre les photos demandées
        if not ids or ids == "all":
            cursor = db.wedding_photos.find({"wedding_id": wedding_id}).sort([("order", 1), ("created_at", 1)])
            photos_list = [p async for p in cursor]
        else:
            id_list = [i.strip() for i in ids.split(",") if i.strip()]
            cursor = db.wedding_photos.find({"wedding_id": wedding_id, "id": {"$in": id_list}})
            photos_list = [p async for p in cursor]
        if not photos_list:
            raise HTTPException(status_code=404, detail="Aucune photo trouvée")
        if len(photos_list) > ZIP_MAX_PHOTOS:
            raise HTTPException(status_code=413, detail=f"Maximum {ZIP_MAX_PHOTOS} photos par téléchargement")
        dirs = ensure_photos_dirs(UPLOAD_DIR, wedding_id)
        originals_dir = dirs["originals"]
        # Single photo → direct download
        if len(photos_list) == 1:
            p = photos_list[0]
            path = originals_dir / p["filename"]
            if not path.exists():
                raise HTTPException(status_code=404, detail="Fichier introuvable")
            return FileResponse(str(path), media_type="image/jpeg", filename=p["filename"])
        # Multi → ZIP streaming. Récupère le nom du couple depuis une vidéo du mariage.
        video_doc = await db.videos.find_one({"client_id": wedding_id}, {"client_name": 1, "title": 1})
        couple = (video_doc or {}).get("client_name") or (video_doc or {}).get("title") or "mariage"
        safe_name = "".join(c if c.isalnum() or c in "-_" else "_" for c in couple)[:50]
        zip_filename = f"CINEMARIES_{safe_name}_{len(photos_list)}photos.zip"

        def _iter_zip():
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, mode="w", compression=zipfile.ZIP_STORED) as zf:
                for p in photos_list:
                    path = originals_dir / p["filename"]
                    if path.exists():
                        zf.write(str(path), arcname=p["filename"])
            buf.seek(0)
            while True:
                chunk = buf.read(64 * 1024)
                if not chunk:
                    break
                yield chunk

        return StreamingResponse(
            _iter_zip(),
            media_type="application/zip",
            headers={"Content-Disposition": f'attachment; filename="{zip_filename}"'},
        )

    # ====== ADMIN ENDPOINTS ======

    @api_router.post("/admin/weddings/{wedding_id}/photos/scan")
    async def admin_scan_photos(wedding_id: str, _: dict = Depends(require_admin)):
        """
        Scanne /srv/.../photos/{wedding_id}/originals/, génère les vignettes
        manquantes et synchronise la collection wedding_photos.
        """
        if not PILLOW_AVAILABLE:
            raise HTTPException(status_code=500, detail="Pillow non installé sur le serveur (pip install Pillow)")
        if not await _wedding_exists(db, wedding_id):
            raise HTTPException(status_code=404, detail="Mariage introuvable")
        dirs = ensure_photos_dirs(UPLOAD_DIR, wedding_id)
        originals_dir = dirs["originals"]
        thumbs_dir = dirs["thumbs"]
        # Lister fichiers disque
        disk_files = sorted([
            f.name for f in originals_dir.iterdir()
            if f.is_file() and f.suffix.lower() in ALLOWED_PHOTO_EXTS
        ])
        if len(disk_files) > PHOTOS_PER_WEDDING_MAX:
            raise HTTPException(
                status_code=413,
                detail=f"Trop de photos : {len(disk_files)}. Maximum autorisé : {PHOTOS_PER_WEDDING_MAX}",
            )
        # Lister fichiers déjà en DB
        existing_filenames = set()
        async for p in db.wedding_photos.find({"wedding_id": wedding_id}, {"filename": 1, "id": 1}):
            existing_filenames.add(p["filename"])
        added = 0
        thumb_generated = 0
        skipped = 0
        errors = []
        for idx, fname in enumerate(disk_files):
            src = originals_dir / fname
            thumb = thumbs_dir / fname
            # Générer vignette si manquante
            if not thumb.exists():
                try:
                    info = generate_thumbnail(src, thumb)
                    thumb_generated += 1
                except Exception as exc:
                    errors.append(f"{fname}: {exc}")
                    continue
                w, h = info["width"], info["height"]
            else:
                w, h = None, None
                try:
                    with Image.open(src) as im:
                        w, h = im.size
                except Exception:
                    pass
            # Ajouter en DB si absent
            if fname not in existing_filenames:
                await db.wedding_photos.insert_one({
                    "id": str(uuid.uuid4()),
                    "wedding_id": wedding_id,
                    "filename": fname,
                    "order": idx,
                    "size_bytes": src.stat().st_size,
                    "width": w,
                    "height": h,
                    "created_at": utcnow(),
                })
                added += 1
            else:
                # Mettre à jour l'ordre selon l'ordre alphabétique
                await db.wedding_photos.update_one(
                    {"wedding_id": wedding_id, "filename": fname},
                    {"$set": {"order": idx}},
                )
                skipped += 1
        # Supprimer les entrées DB des fichiers qui n'existent plus sur disque
        disk_set = set(disk_files)
        removed = 0
        async for p in db.wedding_photos.find({"wedding_id": wedding_id}, {"filename": 1, "id": 1}):
            if p["filename"] not in disk_set:
                await db.wedding_photos.delete_one({"id": p["id"]})
                # Aussi supprimer les vignettes orphelines
                thumb = thumbs_dir / p["filename"]
                if thumb.exists():
                    thumb.unlink()
                removed += 1
        return {
            "ok": True,
            "disk_count": len(disk_files),
            "added": added,
            "skipped": skipped,
            "removed": removed,
            "thumbnails_generated": thumb_generated,
            "errors": errors,
        }

    @api_router.post("/admin/weddings/{wedding_id}/photos/upload")
    async def admin_upload_photo(
        wedding_id: str,
        file: UploadFile = File(...),
        _: dict = Depends(require_admin),
    ):
        """Upload direct d'une photo depuis l'admin UI (alternative au SFTP)."""
        if not PILLOW_AVAILABLE:
            raise HTTPException(status_code=500, detail="Pillow non installé")
        if not await _wedding_exists(db, wedding_id):
            raise HTTPException(status_code=404, detail="Mariage introuvable")
        # Vérifier extension
        ext = Path(file.filename or "").suffix.lower()
        if ext not in ALLOWED_PHOTO_EXTS:
            raise HTTPException(status_code=400, detail=f"Format non supporté. Acceptés : {ALLOWED_PHOTO_EXTS}")
        # Limite count
        current_count = await db.wedding_photos.count_documents({"wedding_id": wedding_id})
        if current_count >= PHOTOS_PER_WEDDING_MAX:
            raise HTTPException(status_code=413, detail=f"Maximum {PHOTOS_PER_WEDDING_MAX} photos par mariage")
        dirs = ensure_photos_dirs(UPLOAD_DIR, wedding_id)
        # Nom unique
        safe_name = f"{uuid.uuid4().hex[:12]}{ext}"
        src = dirs["originals"] / safe_name
        # Écrire le fichier
        data = await file.read()
        with open(src, "wb") as f:
            f.write(data)
        # Générer vignette
        thumb = dirs["thumbs"] / safe_name
        try:
            info = generate_thumbnail(src, thumb)
        except Exception as exc:
            src.unlink(missing_ok=True)
            raise HTTPException(status_code=500, detail=f"Erreur vignette : {exc}")
        # Insérer en DB
        photo_id = str(uuid.uuid4())
        await db.wedding_photos.insert_one({
            "id": photo_id,
            "wedding_id": wedding_id,
            "filename": safe_name,
            "order": current_count,
            "size_bytes": len(data),
            "width": info["width"],
            "height": info["height"],
            "created_at": utcnow(),
        })
        return {
            "id": photo_id,
            "filename": safe_name,
            "thumb_url": f"/api/uploads/photos/{wedding_id}/thumbs/{safe_name}",
            "full_url": f"/api/uploads/photos/{wedding_id}/originals/{safe_name}",
        }

    @api_router.delete("/admin/weddings/{wedding_id}/photos/{photo_id}")
    async def admin_delete_photo(
        wedding_id: str,
        photo_id: str,
        _: dict = Depends(require_admin),
    ):
        p = await db.wedding_photos.find_one({"id": photo_id, "wedding_id": wedding_id})
        if not p:
            raise HTTPException(status_code=404, detail="Photo introuvable")
        dirs = ensure_photos_dirs(UPLOAD_DIR, wedding_id)
        fname = p["filename"]
        (dirs["originals"] / fname).unlink(missing_ok=True)
        (dirs["thumbs"] / fname).unlink(missing_ok=True)
        await db.wedding_photos.delete_one({"id": photo_id})
        await db.photo_favorites.delete_many({"photo_id": photo_id})
        return {"ok": True}

    @api_router.delete("/admin/weddings/{wedding_id}/photos")
    async def admin_delete_all_photos(
        wedding_id: str,
        _: dict = Depends(require_admin),
    ):
        """Supprime TOUTES les photos d'un mariage (DB + disque)."""
        dirs = ensure_photos_dirs(UPLOAD_DIR, wedding_id)
        # Supprimer fichiers disque
        for f in dirs["originals"].iterdir():
            if f.is_file():
                f.unlink(missing_ok=True)
        for f in dirs["thumbs"].iterdir():
            if f.is_file():
                f.unlink(missing_ok=True)
        # Supprimer DB
        res = await db.wedding_photos.delete_many({"wedding_id": wedding_id})
        await db.photo_favorites.delete_many({"wedding_id": wedding_id})
        return {"ok": True, "deleted": res.deleted_count}

    @api_router.post("/admin/weddings/{wedding_id}/music")
    async def admin_upload_music(
        wedding_id: str,
        file: UploadFile = File(...),
        _: dict = Depends(require_admin),
    ):
        """Upload de la musique du diaporama (1 par mariage)."""
        if not await _wedding_exists(db, wedding_id):
            raise HTTPException(status_code=404, detail="Mariage introuvable")
        settings = await _get_wedding_settings(db, wedding_id)
        ext = Path(file.filename or "").suffix.lower()
        if ext not in ALLOWED_MUSIC_EXTS:
            raise HTTPException(status_code=400, detail=f"Format non supporté. Acceptés : {ALLOWED_MUSIC_EXTS}")
        dirs = ensure_photos_dirs(UPLOAD_DIR, wedding_id)
        # Supprimer ancienne musique si présente
        old = settings.get("music_filename")
        if old:
            (dirs["base"] / old).unlink(missing_ok=True)
        # Nouveau nom
        new_name = f"music{ext}"
        path = dirs["base"] / new_name
        data = await file.read()
        with open(path, "wb") as f:
            f.write(data)
        await db.wedding_settings.update_one(
            {"wedding_id": wedding_id},
            {"$set": {"wedding_id": wedding_id, "music_filename": new_name, "music_size": len(data), "updated_at": utcnow()}},
            upsert=True,
        )
        return {
            "ok": True,
            "music_url": f"/api/uploads/photos/{wedding_id}/{new_name}",
            "size_bytes": len(data),
        }

    @api_router.delete("/admin/weddings/{wedding_id}/music")
    async def admin_delete_music(
        wedding_id: str,
        _: dict = Depends(require_admin),
    ):
        if not await _wedding_exists(db, wedding_id):
            raise HTTPException(status_code=404, detail="Mariage introuvable")
        settings = await _get_wedding_settings(db, wedding_id)
        old = settings.get("music_filename")
        if old:
            dirs = ensure_photos_dirs(UPLOAD_DIR, wedding_id)
            (dirs["base"] / old).unlink(missing_ok=True)
        await db.wedding_settings.update_one(
            {"wedding_id": wedding_id},
            {"$unset": {"music_filename": "", "music_size": ""}},
        )
        return {"ok": True}

    # ===== Stats overview (admin) =====
    @api_router.get("/admin/weddings/{wedding_id}/photos/stats")
    async def admin_photos_stats(wedding_id: str, _: dict = Depends(require_admin)):
        """Renvoie un récap pour l'admin UI."""
        count = await db.wedding_photos.count_documents({"wedding_id": wedding_id})
        storage = 0
        async for p in db.wedding_photos.find({"wedding_id": wedding_id}, {"size_bytes": 1}):
            storage += p.get("size_bytes", 0) or 0
        settings = await _get_wedding_settings(db, wedding_id)
        music_filename = settings.get("music_filename")
        music_size = settings.get("music_size", 0)
        # Vérifier l'état du dossier disque
        dirs = ensure_photos_dirs(UPLOAD_DIR, wedding_id)
        disk_files = [f.name for f in dirs["originals"].iterdir() if f.is_file() and f.suffix.lower() in ALLOWED_PHOTO_EXTS]
        return {
            "wedding_id": wedding_id,
            "photos_count": count,
            "storage_bytes": storage,
            "disk_files_count": len(disk_files),
            "needs_scan": len(disk_files) != count,
            "music_filename": music_filename,
            "music_size": music_size,
            "max_photos": PHOTOS_PER_WEDDING_MAX,
            "originals_path": str(dirs["originals"]),
        }

    return api_router

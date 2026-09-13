"""Livrables du suivi de projet CINÉMARIÉS.

Relie les étapes 5, 6, 7 (et 9) du suivi de projet à des actions concrètes dans l'app :

  5. Photos déposées sur votre espace
       - ZIP (peu de photos) : déposé dans ftp_drop (« {Mariés} photos.zip ») ou choisi depuis
         l'admin → extraction dans la galerie privée des mariés (vignettes + DB wedding_photos).
       - Lien Synology (beaucoup de photos) : l'admin colle le lien de partage → bouton
         « Télécharger mes photos » chez les mariés.
  6. Sélection des 40 photos
       - Galerie : les mariés cochent jusqu'à SELECTION_MAX photos et valident.
       - Lien : les mariés saisissent la liste des noms de fichiers et/ou un lien.
  7. Musique de mariage : titre / artiste / lien et/ou fichier audio.
  9. Livraison : lien de téléchargement (films > 40 Go sur Synology).

Toutes les actions font passer l'étape correspondante en « Terminé » et alertent
l'admin avec les mêmes réglages email/SMS que l'import automatique.

Données : `project_tracking.deliverables` :
{
  photos:    {mode: "gallery"|"link"|null, link, imported_count, updated_at,
              import: {status, total, done, error, filename}},
  selection: {photo_ids: [], filenames_text, link, note, count, submitted_at},
  music:     {title, artist, link, note, file_name, file_url, submitted_at},
  delivery:  {link, updated_at},
}
"""
from __future__ import annotations

import asyncio
import logging
import re
import shutil
import subprocess
import unicodedata
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from mailer import send_email, render_email, is_configured as smtp_configured
from photos import ALLOWED_PHOTO_EXTS, ALLOWED_MUSIC_EXTS, ensure_photos_dirs, generate_thumbnail
from project_tracking import (
    STATUS_DONE, STATUS_PENDING, STATUS_IN_PROGRESS,
    notify_step_change, send_brevo_sms, normalize_fr_phone,
)

log = logging.getLogger("project_deliverables")

SELECTION_MAX = 40            # cases cochées dans la galerie
SELECTION_UPLOAD_MAX = 50     # photos envoyées directement par les mariés (tolérance)
SELECTION_UPLOAD_FILE_MAX = 60 * 1024 * 1024
REMINDER_EVERY_DAYS = 7       # 1re relance 7 j après la mise à dispo des photos, puis tous les 7 j
REMINDER_MAX = 3
REMINDER_CHECK_SECONDS = 6 * 3600
MUSIC_FILE_MAX_BYTES = 40 * 1024 * 1024
ZIP_SKIP_PARTS = {"__MACOSX"}
ARCHIVE_EXTS = {".zip", ".rar", ".7z"}
ZIP_KEYWORDS = ("photos", "photo", "selection", "sélection", "galerie")


def _utcnow():
    return datetime.now(timezone.utc)


def _clean_link(raw: Optional[str]) -> Optional[str]:
    if not raw:
        return None
    link = raw.strip()
    if not link:
        return None
    if not re.match(r"^https?://", link, re.I):
        link = "https://" + link
    if len(link) > 2000:
        raise HTTPException(400, "Lien trop long")
    return link


def _safe_filename(name: str, used: set[str]) -> str:
    """Nom de fichier ASCII lisible (les mariés citent les noms dans leur sélection), unique par galerie."""
    base = Path(name).name
    stem, ext = Path(base).stem, Path(base).suffix.lower()
    stem = unicodedata.normalize("NFKD", stem).encode("ascii", "ignore").decode()
    stem = re.sub(r"[^A-Za-z0-9._-]+", "_", stem).strip("._") or "photo"
    candidate = f"{stem}{ext}"
    i = 2
    while candidate.lower() in used:
        candidate = f"{stem}_{i}{ext}"
        i += 1
    used.add(candidate.lower())
    return candidate


def zip_couple_name(filename: str) -> str:
    """« Yassina & Bensaid photos.zip » → « Yassina & Bensaid »."""
    stem = Path(filename).stem
    words = [w for w in re.split(r"\s+", stem) if w]
    kept = [w for w in words if unicodedata.normalize("NFKD", w).encode("ascii", "ignore").decode().lower() not in
            {unicodedata.normalize("NFKD", k).encode("ascii", "ignore").decode() for k in ZIP_KEYWORDS}]
    return " ".join(kept).strip(" -_:") or stem


def _which(*names: str) -> Optional[str]:
    """Binaire système (le service systemd a un PATH réduit → chemins usuels en repli)."""
    for n in names:
        found = shutil.which(n)
        if found:
            return found
        for d in ("/usr/bin", "/usr/local/bin", "/bin", "/snap/bin"):
            if Path(d, n).exists():
                return str(Path(d, n))
    return None


def _is_wanted_image(rel: Path) -> bool:
    return rel.suffix.lower() in ALLOWED_PHOTO_EXTS and not any(
        part in ZIP_SKIP_PARTS or part.startswith(".") for part in rel.parts
    )


def extract_archive(archive: Path, tmp_dir: Path) -> list[tuple[str, Path]]:
    """Extrait une archive ZIP / RAR / 7z dans tmp_dir et renvoie [(nom relatif, chemin extrait)] des images.
    RAR/7z : outils système `unrar` / `7z` (installés sur le VPS). Bloquant → à appeler via asyncio.to_thread."""
    tmp_dir.mkdir(parents=True, exist_ok=True)
    ext = archive.suffix.lower()
    if ext == ".zip":
        with zipfile.ZipFile(archive) as zf:
            wanted = [m for m in zf.infolist() if not m.is_dir() and _is_wanted_image(Path(m.filename))]
            zf.extractall(tmp_dir, members=wanted)  # zipfile neutralise les chemins ../ et absolus
    elif ext == ".rar":
        exe = _which("unrar")
        if not exe:
            raise RuntimeError("Archive RAR : l'outil « unrar » n'est pas installé sur le serveur")
        r = subprocess.run([exe, "x", "-o+", "-y", "-inul", str(archive), str(tmp_dir) + "/"], capture_output=True, text=True, timeout=3600)
        if r.returncode not in (0, 1):  # 1 = avertissement non bloquant
            raise RuntimeError(f"unrar a échoué (code {r.returncode}) : {(r.stderr or r.stdout)[:200]}")
    elif ext == ".7z":
        exe = _which("7z", "7za", "7zz")
        if not exe:
            raise RuntimeError("Archive 7z : l'outil « 7z » n'est pas installé sur le serveur")
        r = subprocess.run([exe, "x", "-y", f"-o{tmp_dir}", str(archive)], capture_output=True, text=True, timeout=3600)
        if r.returncode not in (0, 1):
            raise RuntimeError(f"7z a échoué (code {r.returncode}) : {(r.stderr or r.stdout)[:200]}")
    else:
        raise ValueError(f"Format d'archive non pris en charge ({ext}). Acceptés : {', '.join(sorted(ARCHIVE_EXTS))}")
    found = []
    for f in sorted(tmp_dir.rglob("*")):
        if f.is_file():
            rel = f.relative_to(tmp_dir)
            if _is_wanted_image(rel):
                found.append((str(rel), f))
    return found


# ---------------------------------------------------------------------------
# API MODELS
# ---------------------------------------------------------------------------
class SelectionBody(BaseModel):
    photo_ids: Optional[list[str]] = None   # None → conserver les photos déjà cochées dans la galerie
    filenames_text: Optional[str] = Field(default=None, max_length=8000)
    link: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=2000)


class MusicBody(BaseModel):
    title: Optional[str] = Field(default=None, max_length=200)
    artist: Optional[str] = Field(default=None, max_length=200)
    link: Optional[str] = None
    note: Optional[str] = Field(default=None, max_length=2000)


class LinkItem(BaseModel):
    label: str = Field(default="", max_length=120)
    url: str = Field(min_length=1, max_length=2000)


class DeliverableLinksBody(BaseModel):
    # Plusieurs liens libellés (ex. « Photos cérémonie », « Film complet ») ; [] → tout supprimer
    photos_links: Optional[list[LinkItem]] = None
    delivery_links: Optional[list[LinkItem]] = None
    notify: bool = True


def _clean_links(items: list[LinkItem], default_label: str) -> list[dict]:
    out = []
    for i, it in enumerate(items):
        url = _clean_link(it.url)
        if not url:
            continue
        label = (it.label or "").strip() or (default_label if len(items) == 1 else f"{default_label} {i + 1}")
        out.append({"label": label, "url": url})
    return out


class ZipImportBody(BaseModel):
    filename: str


# ---------------------------------------------------------------------------
# ROUTER FACTORY
# ---------------------------------------------------------------------------
def register_project_deliverables_routes(
    api_router: APIRouter,
    db,
    UPLOAD_DIR: Path,
    FTP_DROP_DIR: Path,
    APP_PUBLIC_URL: str,
    get_current_user,
    require_admin,
    decode_jwt,
    auto_importer,
):
    public_url = (APP_PUBLIC_URL or "").rstrip("/")

    def _abs(url: str) -> str:
        return f"{public_url}{url}" if public_url and url.startswith("/") else url

    # ---------------- helpers ----------------
    async def _get_project(client_id: str) -> dict:
        p = await db.project_tracking.find_one({"client_id": client_id}, {"_id": 0})
        if not p:
            raise HTTPException(404, "Suivi de projet introuvable")
        p.setdefault("deliverables", {})
        return p

    async def _assert_owner(user: dict, client_id: str, project: dict):
        if user.get("is_admin"):
            return
        if user.get("client_id") == client_id or user.get("claimed_client_id") == client_id:
            return
        if project.get("owner_user_id") == user.get("id"):
            return
        raise HTTPException(403, "Ce suivi ne vous appartient pas")

    async def _set_deliverable(client_id: str, section: str, data: dict):
        data = {**data, "updated_at": _utcnow()}
        await db.project_tracking.update_one(
            {"client_id": client_id},
            {"$set": {f"deliverables.{section}": data, "updated_at": _utcnow()}},
        )

    async def _set_step(client_id: str, step_key: str, status: str, notify_couple: bool):
        """Change l'état d'une étape (même sémantique que l'admin) et prévient les mariés si demandé."""
        p = await db.project_tracking.find_one({"client_id": client_id})
        if not p:
            return
        steps = p.get("steps") or []
        target = next((s for s in steps if s.get("key") == step_key), None)
        if not target or target.get("status") == status:
            return
        now = _utcnow()
        old = target.get("status")
        target["status"] = status
        if status == STATUS_IN_PROGRESS and old == STATUS_PENDING:
            target["started_at"] = now
        if status == STATUS_DONE:
            target.setdefault("started_at", now)
            target["started_at"] = target.get("started_at") or now
            target["completed_at"] = now
        if status == STATUS_PENDING:
            target["started_at"] = None
            target["completed_at"] = None
        if notify_couple and status in (STATUS_DONE, STATUS_IN_PROGRESS):
            target["notified_at"] = now
        await db.project_tracking.update_one({"client_id": client_id}, {"$set": {"steps": steps, "updated_at": now}})
        if notify_couple and status in (STATUS_DONE, STATUS_IN_PROGRESS):
            p2 = await db.project_tracking.find_one({"client_id": client_id}, {"_id": 0})
            await notify_step_change(p2, target, background=True)

    async def _alert_admin(title: str, lines: list[str], sms: str):
        """Alerte studio : mêmes réglages que l'import automatique (Admin → Importation automatique)."""
        try:
            cfg = await auto_importer.get_settings()
            if cfg.get("notify_email") and cfg.get("notify_email_to") and smtp_configured():
                html = render_email(
                    title, "".join(f"<p>{l}</p>" for l in lines),
                    cta_label="Ouvrir les suivis de projet", cta_url=f"{public_url or 'https://cinemaries.fr'}/admin/projects",
                )
                try:
                    await send_email(cfg["notify_email_to"], f"CINÉMARIÉS — {title}", html)
                except Exception as e:
                    log.warning("[deliverables] email alerte impossible: %s", e)
            if cfg.get("notify_sms") and cfg.get("notify_phone"):
                phone = normalize_fr_phone(cfg["notify_phone"])
                if phone:
                    await send_brevo_sms(phone, sms[:160], tag="project_deliverables")
            log.info("[deliverables] alerte admin: %s", title)
        except Exception as e:
            log.warning("[deliverables] alerte ignorée: %s", e)

    def _public(p: dict) -> dict:
        p = {k: v for k, v in p.items() if k != "_id"}
        done = sum(1 for s in p.get("steps", []) if s.get("status") == STATUS_DONE)
        total = len(p.get("steps", [])) or 1
        p["progress_percent"] = int(round(done / total * 100))
        p["current_step_index"] = next((i for i, s in enumerate(p.get("steps", [])) if s.get("status") != STATUS_DONE), total - 1)
        return p

    # ---------------- Archive (ZIP / RAR / 7z) → galerie ----------------
    async def import_zip_to_gallery(client_id: str, zip_path: Path, *, delete_zip: bool, notify_couple: bool = True) -> dict:
        """Extrait les images de l'archive (ZIP, RAR, 7z) dans la galerie privée du mariage. Tourne en tâche de fond."""
        p = await db.project_tracking.find_one({"client_id": client_id}, {"_id": 0, "wedding_name": 1, "deliverables": 1})
        wedding_name = (p or {}).get("wedding_name") or client_id
        await _set_deliverable(client_id, "photos", {
            **((p or {}).get("deliverables", {}).get("photos") or {}),
            "import": {"status": "running", "total": 0, "done": 0, "error": None, "filename": zip_path.name},
        })
        dirs = ensure_photos_dirs(UPLOAD_DIR, client_id)
        used = {f.name.lower() for f in dirs["originals"].iterdir() if f.is_file()}
        existing_order = await db.wedding_photos.count_documents({"wedding_id": client_id})
        added, errors, total = 0, [], 0
        tmp_dir = UPLOAD_DIR / "tmp_zips" / f"extract_{uuid.uuid4().hex}"
        try:
            members = await asyncio.to_thread(extract_archive, zip_path, tmp_dir)
            if not members:
                raise ValueError("Aucune image (.jpg/.jpeg/.png/.webp) dans cette archive")
            total = len(members)
            await db.project_tracking.update_one({"client_id": client_id}, {"$set": {"deliverables.photos.import.total": total}})
            for idx, (rel_name, src_path) in enumerate(members):
                fname = _safe_filename(rel_name, used)
                dst = dirs["originals"] / fname
                try:
                    shutil.move(str(src_path), str(dst))
                    info = await asyncio.to_thread(generate_thumbnail, dst, dirs["thumbs"] / fname)
                except Exception as exc:
                    dst.unlink(missing_ok=True)
                    errors.append(f"{rel_name}: {exc}")
                    continue
                await db.wedding_photos.insert_one({
                    "id": str(uuid.uuid4()),
                    "wedding_id": client_id,
                    "filename": fname,
                    "original_name": Path(rel_name).name,
                    "order": existing_order + idx,
                    "size_bytes": dst.stat().st_size,
                    "width": info["width"],
                    "height": info["height"],
                    "created_at": _utcnow(),
                })
                added += 1
                if added % 10 == 0:
                    await db.project_tracking.update_one({"client_id": client_id}, {"$set": {"deliverables.photos.import.done": added}})
            count = await db.wedding_photos.count_documents({"wedding_id": client_id})
            await _set_deliverable(client_id, "photos", {
                **(((await _get_project(client_id)).get("deliverables") or {}).get("photos") or {}),
                "mode": "gallery", "imported_count": count,
                "import": {"status": "done", "total": total, "done": added, "error": None, "filename": zip_path.name,
                           "errors": errors[:20], "finished_at": _utcnow()},
            })
            if delete_zip:
                zip_path.unlink(missing_ok=True)
            await _set_step(client_id, "photos_delivery", STATUS_DONE, notify_couple)
            await _alert_admin(
                "📸 Photos importées dans la galerie",
                [f"<b>Mariage :</b> {wedding_name}", f"<b>ZIP :</b> {zip_path.name}", f"<b>Photos ajoutées :</b> {added} (galerie : {count})"]
                + ([f"<b>Erreurs :</b> {len(errors)}"] if errors else []),
                f"CINEMARIES: {added} photos importees pour {wedding_name} ({zip_path.name[:40]})",
            )
            log.info("[deliverables] ZIP %s → %s : %d photos", zip_path.name, client_id, added)
            return {"ok": True, "added": added, "total": total, "errors": errors}
        except Exception as exc:
            log.exception("[deliverables] échec import ZIP %s", zip_path.name)
            await db.project_tracking.update_one(
                {"client_id": client_id},
                {"$set": {"deliverables.photos.import": {"status": "error", "total": 0, "done": added, "error": str(exc), "filename": zip_path.name}}},
            )
            await _alert_admin("❌ Import ZIP photos — ERREUR", [f"<b>Mariage :</b> {wedding_name}", f"<b>ZIP :</b> {zip_path.name}", f"{exc}"],
                               f"CINEMARIES: ERREUR import ZIP {zip_path.name[:50]}")
            return {"ok": False, "error": str(exc), "added": added}
        finally:
            shutil.rmtree(tmp_dir, ignore_errors=True)

    async def _match_project_for_zip(name: str):
        """Mariage cible d'un ZIP déposé par FTP : suivis de projet d'abord, puis mariages (vidéos)."""
        from auto_import import couple_key
        key = couple_key(name)
        slug = auto_importer.slugify(name)
        projects = await db.project_tracking.find({}, {"_id": 0, "client_id": 1, "wedding_name": 1}).to_list(1000)
        for p in projects:
            if p["client_id"] == slug or couple_key(p.get("wedding_name") or "") == key or couple_key(p["client_id"]) == key:
                return p["client_id"], p.get("wedding_name") or p["client_id"]
        # prénom seul → suivis dont le nom contient ce mot
        tokens = {t for t in re.split(r"[^a-z0-9]+", key) if len(t) >= 3}
        if tokens:
            hits = [p for p in projects if tokens <= {t for t in re.split(r"[^a-z0-9]+", couple_key(p.get("wedding_name") or "") + " " + couple_key(p["client_id"])) if t}]
            if len(hits) == 1:
                return hits[0]["client_id"], hits[0].get("wedding_name") or hits[0]["client_id"]
            if len(hits) > 1:
                return "ambiguous"
        match = await auto_importer._match_wedding_for_media(name)
        return match

    async def handle_ftp_zip(importer, job_id: str, path: Path):
        """Hook appelé par le watcher d'import automatique pour les fichiers .zip."""
        couple = zip_couple_name(path.name)
        await importer._job_set(job_id, type="photos_zip", type_label="Photos (ZIP)", couple=couple)
        match = await _match_project_for_zip(couple)
        if match is None:
            await importer._job_set(job_id, status="PENDING", file_location="ftp_drop",
                                    message=f"En attente du suivi de projet correspondant à « {couple} » (créez le suivi dans Admin → Suivi de projet).")
            return
        if match == "ambiguous":
            await importer._job_set(job_id, status="PENDING", file_location="ftp_drop",
                                    message=f"Plusieurs mariages correspondent à « {couple} ». Renommez le ZIP avec le nom complet des mariés.")
            return
        client_id, client_name = match
        # S'assurer qu'un suivi existe (le ZIP peut arriver avant que l'admin ait créé le suivi)
        if not await db.project_tracking.find_one({"client_id": client_id}):
            await importer._job_set(job_id, status="PENDING", file_location="ftp_drop", client_id=client_id, client_name=client_name,
                                    message=f"Mariage « {client_name} » trouvé mais aucun suivi de projet : créez-le dans Admin → Suivi de projet.")
            return
        await importer._job_set(job_id, client_id=client_id, client_name=client_name)
        res = await import_zip_to_gallery(client_id, path, delete_zip=True)
        if res.get("ok"):
            await importer._job_set(job_id, status="PROCESSED", result="photos_gallery", file_location="gallery",
                                    message=f"{res['added']} photos ajoutées à la galerie privée de {client_name}.", processed_at=_utcnow())
        else:
            await importer._fail(job_id, path, res.get("error") or "Erreur d'extraction du ZIP")

    auto_importer.zip_handler = handle_ftp_zip

    # =====================================================================
    # CLIENT (mariés)
    # =====================================================================
    @api_router.get("/projects/{client_id}/deliverables")
    async def get_deliverables(client_id: str, current: dict = Depends(get_current_user)):
        p = await _get_project(client_id)
        await _assert_owner(current, client_id, p)
        photos_count = await db.wedding_photos.count_documents({"wedding_id": client_id})
        d = p.get("deliverables") or {}
        return {
            "client_id": client_id,
            "wedding_name": p.get("wedding_name"),
            "deliverables": d,
            "photos_count": photos_count,
            "selection_max": SELECTION_MAX,
            "steps": {s["key"]: s.get("status") for s in p.get("steps", [])},
        }

    @api_router.post("/projects/{client_id}/selection")
    async def submit_selection(client_id: str, body: SelectionBody, current: dict = Depends(get_current_user)):
        p = await _get_project(client_id)
        await _assert_owner(current, client_id, p)
        prev_sel = (p.get("deliverables") or {}).get("selection") or {}
        raw_ids = body.photo_ids if body.photo_ids is not None else (prev_sel.get("photo_ids") or [])
        ids = list(dict.fromkeys(i.strip() for i in raw_ids if i and i.strip()))
        if len(ids) > SELECTION_MAX:
            raise HTTPException(400, f"Maximum {SELECTION_MAX} photos")
        names: list[str] = []
        if ids:
            docs = await db.wedding_photos.find({"wedding_id": client_id, "id": {"$in": ids}}, {"_id": 0, "id": 1, "filename": 1, "original_name": 1}).to_list(SELECTION_MAX + 1)
            if len(docs) != len(ids):
                raise HTTPException(400, "Certaines photos n'existent plus, rechargez la galerie")
            by_id = {d["id"]: d for d in docs}
            names = [by_id[i].get("original_name") or by_id[i]["filename"] for i in ids]
        text = (body.filenames_text or "").strip()
        link = _clean_link(body.link)
        uploads = prev_sel.get("uploads") or []
        if not ids and not uploads and not text and not link:
            raise HTTPException(400, "Cochez vos photos dans la galerie ou envoyez-nous vos photos choisies")
        count = (len(ids) + len(uploads)) or len([t for t in re.split(r"[,\n;]+", text) if t.strip()])
        data = {**prev_sel, "photo_ids": ids, "filenames": names, "filenames_text": text or None, "link": link, "uploads": uploads,
                "note": (body.note or "").strip() or None, "count": count, "submitted_at": _utcnow(),
                "user_id": current.get("id"), "user_email": current.get("email")}
        await _set_deliverable(client_id, "selection", data)
        await _set_step(client_id, "photo_selection", STATUS_DONE, notify_couple=False)
        wedding = p.get("wedding_name") or client_id
        await _alert_admin(
            "✅ Sélection de photos reçue",
            [f"<b>Mariage :</b> {wedding}", f"<b>Photos :</b> {count}", f"<b>Par :</b> {current.get('email')}"]
            + ([f"<b>Photos envoyées :</b> {len(uploads)} (ZIP téléchargeable dans l'admin)"] if uploads else [])
            + ([f"<b>Lien :</b> <a href='{link}'>{link}</a>"] if link else [])
            + ([f"<b>Fichiers :</b> {text[:1500]}"] if text else [])
            + ([f"<b>Note :</b> {data['note']}"] if data.get("note") else []),
            f"CINEMARIES: selection de {count} photos recue pour {wedding}",
        )
        return {"ok": True, "project": _public(await _get_project(client_id))}

    @api_router.post("/projects/{client_id}/selection/upload")
    async def upload_selection_photo(client_id: str, file: UploadFile = File(...), current: dict = Depends(get_current_user)):
        """Les mariés envoient directement une photo choisie (cas lien Synology). Jusqu'à SELECTION_UPLOAD_MAX photos."""
        p = await _get_project(client_id)
        await _assert_owner(current, client_id, p)
        sel = (p.get("deliverables") or {}).get("selection") or {}
        uploads = list(sel.get("uploads") or [])
        if len(uploads) >= SELECTION_UPLOAD_MAX:
            raise HTTPException(400, f"Maximum {SELECTION_UPLOAD_MAX} photos. Supprimez-en une pour en ajouter.")
        ext = Path(file.filename or "").suffix.lower()
        if ext not in ALLOWED_PHOTO_EXTS:
            raise HTTPException(400, "Format non supporté (JPG, PNG ou WEBP)")
        sel_dir = ensure_photos_dirs(UPLOAD_DIR, client_id)["base"] / "selection"
        (sel_dir / "thumbs").mkdir(parents=True, exist_ok=True)
        used = {u["filename"].lower() for u in uploads}
        fname = _safe_filename(file.filename or f"photo{ext}", used)
        dst = sel_dir / fname
        size = 0
        with open(dst, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                size += len(chunk)
                if size > SELECTION_UPLOAD_FILE_MAX:
                    out.close()
                    dst.unlink(missing_ok=True)
                    raise HTTPException(413, "Photo trop lourde (60 Mo max)")
                out.write(chunk)
        try:
            await asyncio.to_thread(generate_thumbnail, dst, sel_dir / "thumbs" / fname)
        except Exception as exc:
            dst.unlink(missing_ok=True)
            raise HTTPException(400, f"Image illisible : {exc}")
        item = {"id": str(uuid.uuid4()), "filename": fname, "original_name": file.filename, "size": size,
                "url": f"/api/uploads/photos/{client_id}/selection/{fname}",
                "thumb_url": f"/api/uploads/photos/{client_id}/selection/thumbs/{fname}", "uploaded_at": _utcnow()}
        uploads.append(item)
        await _set_deliverable(client_id, "selection", {**sel, "uploads": uploads})
        return {"ok": True, "upload": item, "count": len(uploads), "max": SELECTION_UPLOAD_MAX}

    @api_router.delete("/projects/{client_id}/selection/upload/{upload_id}")
    async def delete_selection_photo(client_id: str, upload_id: str, current: dict = Depends(get_current_user)):
        p = await _get_project(client_id)
        await _assert_owner(current, client_id, p)
        sel = (p.get("deliverables") or {}).get("selection") or {}
        uploads = list(sel.get("uploads") or [])
        item = next((u for u in uploads if u["id"] == upload_id), None)
        if not item:
            raise HTTPException(404, "Photo introuvable")
        sel_dir = ensure_photos_dirs(UPLOAD_DIR, client_id)["base"] / "selection"
        (sel_dir / item["filename"]).unlink(missing_ok=True)
        (sel_dir / "thumbs" / item["filename"]).unlink(missing_ok=True)
        uploads = [u for u in uploads if u["id"] != upload_id]
        await _set_deliverable(client_id, "selection", {**sel, "uploads": uploads, "count": len(uploads) if not sel.get("photo_ids") else sel.get("count")})
        return {"ok": True, "count": len(uploads)}

    @api_router.post("/projects/{client_id}/music")
    async def submit_music(client_id: str, body: MusicBody, current: dict = Depends(get_current_user)):
        p = await _get_project(client_id)
        await _assert_owner(current, client_id, p)
        prev = (p.get("deliverables") or {}).get("music") or {}
        link = _clean_link(body.link)
        title = (body.title or "").strip() or None
        artist = (body.artist or "").strip() or None
        note = (body.note or "").strip() or None
        if not (title or link or prev.get("file_url")):
            raise HTTPException(400, "Indiquez au moins un titre, un lien ou envoyez un fichier audio")
        data = {**prev, "title": title, "artist": artist, "link": link, "note": note,
                "submitted_at": _utcnow(), "user_id": current.get("id"), "user_email": current.get("email")}
        await _set_deliverable(client_id, "music", data)
        await _set_step(client_id, "music", STATUS_DONE, notify_couple=False)
        wedding = p.get("wedding_name") or client_id
        await _alert_admin(
            "🎵 Musique de mariage reçue",
            [f"<b>Mariage :</b> {wedding}", f"<b>Titre :</b> {title or '—'} — {artist or '—'}"]
            + ([f"<b>Lien :</b> <a href='{link}'>{link}</a>"] if link else [])
            + ([f"<b>Fichier :</b> {_abs(prev['file_url'])}"] if prev.get("file_url") else [])
            + ([f"<b>Note :</b> {note}"] if note else []),
            f"CINEMARIES: musique recue pour {wedding} - {(title or link or 'fichier')[:60]}",
        )
        return {"ok": True, "project": _public(await _get_project(client_id))}

    @api_router.post("/projects/{client_id}/music/file")
    async def upload_music_file(client_id: str, file: UploadFile = File(...), current: dict = Depends(get_current_user)):
        p = await _get_project(client_id)
        await _assert_owner(current, client_id, p)
        ext = Path(file.filename or "").suffix.lower()
        if ext not in ALLOWED_MUSIC_EXTS:
            raise HTTPException(400, f"Format audio non supporté. Acceptés : {', '.join(sorted(ALLOWED_MUSIC_EXTS))}")
        data = await file.read()
        if len(data) > MUSIC_FILE_MAX_BYTES:
            raise HTTPException(413, "Fichier trop lourd (40 Mo max). Envoyez plutôt un lien.")
        dirs = ensure_photos_dirs(UPLOAD_DIR, client_id)
        prev = (p.get("deliverables") or {}).get("music") or {}
        if prev.get("file_name"):
            (dirs["base"] / prev["file_name"]).unlink(missing_ok=True)
        fname = f"music_request{ext}"
        with open(dirs["base"] / fname, "wb") as f:
            f.write(data)
        url = f"/api/uploads/photos/{client_id}/{fname}"
        await _set_deliverable(client_id, "music", {**prev, "file_name": fname, "file_url": url,
                                                     "file_original_name": file.filename, "file_size": len(data),
                                                     "submitted_at": _utcnow(), "user_id": current.get("id"), "user_email": current.get("email")})
        await _set_step(client_id, "music", STATUS_DONE, notify_couple=False)
        wedding = p.get("wedding_name") or client_id
        await _alert_admin("🎵 Fichier musique reçu", [f"<b>Mariage :</b> {wedding}", f"<b>Fichier :</b> {file.filename} ({len(data) // 1024} Ko)",
                                                      f"<a href='{_abs(url)}'>Écouter / télécharger</a>"],
                           f"CINEMARIES: fichier musique recu pour {wedding}")
        return {"ok": True, "file_url": url, "project": _public(await _get_project(client_id))}

    # =====================================================================
    # ADMIN
    # =====================================================================
    @api_router.patch("/admin/projects/{client_id}/deliverables")
    async def admin_set_links(client_id: str, body: DeliverableLinksBody, admin: dict = Depends(require_admin)):
        p = await _get_project(client_id)
        d = p.get("deliverables") or {}
        if body.photos_links is not None:
            links = _clean_links(body.photos_links, "Mes photos")
            photos = d.get("photos") or {}
            first = links[0]["url"] if links else None
            if links:
                await _set_deliverable(client_id, "photos", {**photos, "links": links, "link": first,
                                                             "mode": photos.get("mode") if photos.get("imported_count") else "link"})
                await _set_step(client_id, "photos_delivery", STATUS_DONE, body.notify)
            else:
                await _set_deliverable(client_id, "photos", {**photos, "links": [], "link": None,
                                                             "mode": "gallery" if photos.get("imported_count") else None})
        if body.delivery_links is not None:
            links = _clean_links(body.delivery_links, "Mon film")
            await _set_deliverable(client_id, "delivery", {"links": links, "link": links[0]["url"] if links else None})
            if links:
                await _set_step(client_id, "delivery", STATUS_DONE, body.notify)
        return _public(await _get_project(client_id))

    @api_router.get("/admin/projects/{client_id}/zip-candidates")
    async def admin_zip_candidates(client_id: str, admin: dict = Depends(require_admin)):
        await _get_project(client_id)
        items = []
        if FTP_DROP_DIR.exists():
            for f in FTP_DROP_DIR.iterdir():
                if f.is_file() and f.suffix.lower() in ARCHIVE_EXTS and not f.name.startswith("."):
                    st = f.stat()
                    items.append({"name": f.name, "size": st.st_size, "modified": datetime.fromtimestamp(st.st_mtime, tz=timezone.utc).isoformat()})
        items.sort(key=lambda x: x["modified"], reverse=True)
        return {"items": items, "drop_path": str(FTP_DROP_DIR)}

    @api_router.post("/admin/projects/{client_id}/photos/import-zip")
    async def admin_import_zip(client_id: str, body: ZipImportBody, admin: dict = Depends(require_admin)):
        """Importe un ZIP déjà déposé par FTP dans la galerie des mariés (tâche de fond)."""
        p = await _get_project(client_id)
        if "/" in body.filename or ".." in body.filename:
            raise HTTPException(400, "Nom de fichier invalide")
        path = FTP_DROP_DIR / body.filename
        if not path.exists() or path.suffix.lower() not in ARCHIVE_EXTS:
            raise HTTPException(404, "Archive (ZIP/RAR/7z) introuvable dans le dossier FTP")
        running = ((p.get("deliverables") or {}).get("photos") or {}).get("import", {}).get("status") == "running"
        if running:
            raise HTTPException(409, "Un import est déjà en cours pour ce mariage")
        asyncio.create_task(import_zip_to_gallery(client_id, path, delete_zip=True))
        return {"ok": True, "started": True, "filename": body.filename}

    @api_router.post("/admin/projects/{client_id}/photos/import-zip/upload")
    async def admin_upload_zip(client_id: str, file: UploadFile = File(...), admin: dict = Depends(require_admin)):
        """Upload direct d'un petit ZIP depuis l'admin (sinon passer par le FTP)."""
        p = await _get_project(client_id)
        ext = Path(file.filename or "").suffix.lower()
        if ext not in ARCHIVE_EXTS:
            raise HTTPException(400, "Une archive .zip, .rar ou .7z est attendue")
        running = ((p.get("deliverables") or {}).get("photos") or {}).get("import", {}).get("status") == "running"
        if running:
            raise HTTPException(409, "Un import est déjà en cours pour ce mariage")
        tmp_dir = UPLOAD_DIR / "tmp_zips"
        tmp_dir.mkdir(parents=True, exist_ok=True)
        tmp = tmp_dir / f"{uuid.uuid4().hex}{ext}"
        with open(tmp, "wb") as out:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
        asyncio.create_task(import_zip_to_gallery(client_id, tmp, delete_zip=True))
        return {"ok": True, "started": True, "filename": file.filename}

    @api_router.get("/admin/projects/{client_id}/selection/download")
    async def admin_download_selection(client_id: str, token: Optional[str] = Query(None), admin: Optional[dict] = None):
        """ZIP des photos sélectionnées par les mariés. Auth par ?token= (ouverture dans le navigateur)."""
        user_id = decode_jwt(token or "") if token else None
        u = await db.users.find_one({"id": user_id}, {"_id": 0, "is_admin": 1}) if user_id else None
        if not u or not u.get("is_admin"):
            raise HTTPException(401, "Accès admin requis")
        p = await _get_project(client_id)
        sel = (p.get("deliverables") or {}).get("selection") or {}
        ids = sel.get("photo_ids") or []
        uploads = sel.get("uploads") or []
        if not ids and not uploads:
            raise HTTPException(404, "Aucune photo dans la sélection des mariés")
        photos = await db.wedding_photos.find({"wedding_id": client_id, "id": {"$in": ids}}, {"_id": 0}).to_list(SELECTION_MAX + 1) if ids else []
        dirs = ensure_photos_dirs(UPLOAD_DIR, client_id)
        sel_dir = dirs["base"] / "selection"
        safe = re.sub(r"[^A-Za-z0-9_-]+", "_", p.get("wedding_name") or client_id)[:50]
        files: list[tuple[Path, str]] = [(dirs["originals"] / ph["filename"], ph.get("original_name") or ph["filename"]) for ph in photos]
        files += [(sel_dir / u["filename"], u.get("original_name") or u["filename"]) for u in uploads]

        def _iter():
            import io
            buf = io.BytesIO()
            with zipfile.ZipFile(buf, "w", zipfile.ZIP_STORED) as zf:
                used: set[str] = set()
                for src, name in files:
                    if src.exists():
                        zf.write(str(src), arcname=_safe_filename(name, used))
            buf.seek(0)
            while True:
                chunk = buf.read(64 * 1024)
                if not chunk:
                    break
                yield chunk

        return StreamingResponse(_iter(), media_type="application/zip",
                                 headers={"Content-Disposition": f'attachment; filename="SELECTION_{safe}_{len(files)}photos.zip"'})

    # =====================================================================
    # RELANCE AUTOMATIQUE — sélection des photos non validée
    # =====================================================================
    async def send_selection_reminders(now: Optional[datetime] = None) -> int:
        """SMS (+ email) aux mariés dont les photos sont disponibles depuis ≥ 7 jours sans sélection validée.
        Relance tous les 7 jours, 3 relances maximum. Renvoie le nombre de relances envoyées."""
        now = now or _utcnow()
        sent = 0
        cursor = db.project_tracking.find(
            {"steps": {"$elemMatch": {"key": "photos_delivery", "status": STATUS_DONE}}},
            {"_id": 0, "client_id": 1, "wedding_name": 1, "owner_phone": 1, "owner_email": 1, "steps": 1, "deliverables": 1},
        )
        async for p in cursor:
            steps = {s["key"]: s for s in p.get("steps", [])}
            if steps.get("photo_selection", {}).get("status") == STATUS_DONE:
                continue
            done_at = steps["photos_delivery"].get("completed_at")
            if not done_at:
                continue
            if done_at.tzinfo is None:
                done_at = done_at.replace(tzinfo=timezone.utc)
            sel = (p.get("deliverables") or {}).get("selection") or {}
            reminders = sel.get("reminders") or []
            if len(reminders) >= REMINDER_MAX:
                continue
            last = reminders[-1] if reminders else done_at
            if last.tzinfo is None:
                last = last.replace(tzinfo=timezone.utc)
            if (now - last).days < REMINDER_EVERY_DAYS:
                continue
            phone = normalize_fr_phone(p.get("owner_phone"))
            email = p.get("owner_email")
            if not phone and not email:
                continue
            wedding = p.get("wedding_name") or p["client_id"]
            n = len(reminders) + 1
            sms = (f"CINEMARIES : {wedding} - vos photos vous attendent ! Choisissez vos {SELECTION_MAX} photos preferees "
                   f"pour le montage de votre film : {public_url or 'https://cinemaries.fr'}/profile (rappel {n}/{REMINDER_MAX})")
            ok_any = False
            if phone:
                ok, _ = await send_brevo_sms(phone, sms[:160], tag="selection_reminder")
                ok_any = ok_any or ok
            if email and smtp_configured():
                try:
                    html = render_email(
                        "📸 Vos photos vous attendent",
                        f"<p>Bonjour,</p><p>Les photos de <b>{wedding}</b> sont disponibles dans votre espace depuis quelques jours. "
                        f"Pour lancer le montage de votre film, choisissez vos <b>{SELECTION_MAX} photos préférées</b> depuis votre suivi.</p>"
                        f"<p>Rappel {n}/{REMINDER_MAX}.</p>",
                        cta_label="Choisir mes photos", cta_url=f"{public_url or 'https://cinemaries.fr'}/profile",
                    )
                    await send_email(email, f"CINÉMARIÉS — {wedding} — choisissez vos {SELECTION_MAX} photos", html)
                    ok_any = True
                except Exception as e:
                    log.warning("[deliverables] email relance impossible %s: %s", email, e)
            if not ok_any:
                log.warning("[deliverables] relance non envoyée (SMS/email indisponibles) → %s, nouvel essai plus tard", p["client_id"])
                continue
            reminders.append(now)
            await db.project_tracking.update_one({"client_id": p["client_id"]}, {"$set": {"deliverables.selection.reminders": reminders}})
            log.info("[deliverables] relance sélection %d/%d → %s (sms=%s, email=%s)", n, REMINDER_MAX, p["client_id"], bool(phone), bool(email))
            sent += 1
        return sent

    async def _reminder_loop():
        await asyncio.sleep(60)  # laisser le serveur démarrer
        while True:
            try:
                await send_selection_reminders()
            except Exception as e:
                log.error("[deliverables] boucle relances: %s", e)
            await asyncio.sleep(REMINDER_CHECK_SECONDS)

    asyncio.get_event_loop().create_task(_reminder_loop())

    @api_router.post("/admin/projects/selection-reminders/run")
    async def admin_run_reminders(admin: dict = Depends(require_admin)):
        """Déclenche manuellement le passage des relances (test / contrôle)."""
        n = await send_selection_reminders()
        return {"ok": True, "sent": n}

    log.info("[project_deliverables] routes registered")
    return {"import_zip_to_gallery": import_zip_to_gallery, "send_selection_reminders": send_selection_reminders}

"""
CINÉMARIÉS — Importation automatique depuis le dossier FTP (FileZilla).

Pipeline :
    FTP DROP → FILE WATCHER → FILE STABILITY CHECK → FILENAME PARSER
    → MARRIAGE MATCHER → MARRIAGE CREATION / UPDATE → MEDIA ASSOCIATION
    → PUBLICATION → IMPORT LOG

Réutilise l'existant :
  - collection `videos` (mariage = client_id/client_name, vidéo principale
    "À l'affiche" avec poster_url / hero_url / trailer_url / full_url,
    prestations = vidéos séparées rattachées au même client_id)
  - collection `wedding_meta` (couverture du mariage : poster/hero)
  - stockage : ftp_drop/ → uploads/{uuid}.ext → /api/uploads/{uuid}.ext
    (identique à l'import FTP manuel de l'admin)
  - collection `app_settings` (clé "auto_import") pour la config des prestations

Journal : collection `import_jobs` (statuts PENDING / PROCESSING / PROCESSED / ERROR).
"""

import asyncio
import fcntl
import hashlib
import logging
import os
import re
import shutil
import subprocess
import unicodedata
import uuid
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from mailer import send_email, render_email, is_configured as smtp_configured
from project_tracking import send_brevo_sms, normalize_fr_phone

log = logging.getLogger("auto_import")

# ----------------------------------------------------------------------------
# Constantes
# ----------------------------------------------------------------------------
VIDEO_EXTS = {".mp4", ".mov", ".mkv"}
IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".webp"}
PARTIAL_SUFFIXES = (".filepart", ".part", ".tmp", ".crdownload", ".partial")

SCAN_INTERVAL_SECONDS = float(os.environ.get("AUTO_IMPORT_SCAN_INTERVAL", "5"))
STABLE_SECONDS = float(os.environ.get("AUTO_IMPORT_STABLE_SECONDS", "10"))
FUZZY_THRESHOLD = 0.85  # similarité minimale pour considérer deux noms de mariés comme identiques

STATUS_PENDING = "PENDING"
STATUS_PROCESSING = "PROCESSING"
STATUS_PROCESSED = "PROCESSED"
STATUS_ERROR = "ERROR"

TYPE_PRESTATION = "prestation_video"
TYPE_COMPLETE = "complete_video"
TYPE_POSTER = "poster"
TYPE_HERO = "hero"
TYPE_TRAILER = "trailer"

TYPE_LABELS = {
    TYPE_PRESTATION: "Prestation",
    TYPE_COMPLETE: "Vidéo complète",
    TYPE_POSTER: "Poster",
    TYPE_HERO: "Hero grand format",
    TYPE_TRAILER: "Bande-annonce",
}

MAIN_CATEGORY = "À l'affiche"
CATEGORIES = ["À l'affiche", "Cérémonies", "Soirées", "Best Of"]

DEFAULT_SETTINGS = {
    "enabled": True,
    "default_featured": True,
    "default_showcase": True,
    # Alertes admin à chaque fichier publié / en erreur
    "notify_email": True,
    "notify_email_to": os.environ.get("ADMIN_NOTIFY_EMAIL", ""),
    "notify_sms": False,
    "notify_phone": "",
    "notify_on": "all",  # "all" | "errors"
    "services": [
        {"key": "soiree", "label": "Soirée", "category": "Soirées"},
        {"key": "reception", "label": "Réception", "category": "Soirées"},
        {"key": "ceremonie", "label": "Cérémonie", "category": "Cérémonies"},
        {"key": "mairie", "label": "Mairie", "category": "Cérémonies"},
        {"key": "eglise", "label": "Église", "category": "Cérémonies"},
        {"key": "maoulid", "label": "Maoulid", "category": "Cérémonies"},
        {"key": "oukoumbi", "label": "Oukoumbi", "category": "Cérémonies"},
        {"key": "halal", "label": "Halal", "category": "Cérémonies"},
        {"key": "mazaraka", "label": "Mazaraka", "category": "Cérémonies"},
        {"key": "madjilis", "label": "Madjilis", "category": "Cérémonies"},
        {"key": "henne", "label": "Henné", "category": "Cérémonies"},
        {"key": "fiancailles", "label": "Fiançailles", "category": "Cérémonies"},
        {"key": "best of", "label": "Best Of", "category": "Best Of"},
    ],
}

# Mots génériques ignorés lors de l'association d'un média (Poster/Hero/Bande-annonce)
GENERIC_WORDS = {
    "portrait", "sequence", "photo", "image", "hero", "poster", "trailer", "bande",
    "annonce", "grand", "format", "video", "complete", "mariage", "de", "du", "des",
    "la", "le", "les", "et", "and", "the", "a", "l", "d",
}


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


# ----------------------------------------------------------------------------
# Normalisation texte
# ----------------------------------------------------------------------------
def strip_accents_keep_len(text: str) -> str:
    """Supprime les accents en conservant la longueur (1 char → 1 char)."""
    out = []
    for ch in text:
        decomposed = unicodedata.normalize("NFD", ch)
        base = "".join(c for c in decomposed if not unicodedata.combining(c))
        out.append(base[0] if base else ch)
    return "".join(out)


def normalize(text: str) -> str:
    """Minuscule, sans accents, espaces multiples réduits (longueur conservée sauf trim)."""
    return re.sub(r"\s+", " ", strip_accents_keep_len(text).lower()).strip()


def tokens(text: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9]+", normalize(text)) if t]


def couple_key(name: str) -> str:
    """Clé de comparaison d'un couple : tolère & / et / and, casse, accents, ordre."""
    toks = [t for t in tokens(name) if t not in {"et", "and"}]
    return "-".join(sorted(toks))


class ParseError(Exception):
    pass


# ----------------------------------------------------------------------------
# PARSER CENTRALISÉ
# ----------------------------------------------------------------------------
class MarriageFilenameParser:
    """Analyse le nom d'un fichier déposé et retourne une structure propre.

    >>> MarriageFilenameParser(services).parse("Mariage de Sofie & Mohamed Oukoumbi soiree.mp4")
    {"type": "prestation_video", "couple": "Sofie & Mohamed Oukoumbi", "service": "soiree", ...}
    """

    PREFIXES = [
        (TYPE_COMPLETE, re.compile(r"^video complete\s*:\s*(.+)$")),
        (TYPE_POSTER, re.compile(r"^poster\s*:\s*(.+)$")),
        (TYPE_HERO, re.compile(r"^hero grand format\s*:\s*(.+)$")),
        (TYPE_TRAILER, re.compile(r"^bande[\s\-_]*annonce\s*:\s*(.+)$")),
    ]
    PRESTATION_RE = re.compile(r"^mariage de\s+(.+)$")
    # Forme « {Mariés} {mot-clé} [{prestation}] » (ex: "Yassina & Bensaid video complet Oukoumbi")
    SUFFIX_RE = re.compile(
        r"^(?P<couple>.+?)[\s\-_:]+(?P<kw>bande[\s\-_]*annonce|trailer|(?:hero\s+)?grand\s+format|hero|poster|affiche|"
        r"video\s+complete?|film\s+complet)(?:[\s\-_:]+(?P<rest>.+))?$"
    )

    def __init__(self, services: list[dict]):
        self.services = services or []

    def find_service(self, text: str) -> Optional[dict]:
        """Retourne la prestation connue dont la clé/label correspond exactement au texte normalisé."""
        t = normalize(text)
        for svc in self.services:
            if t in {normalize(svc.get("key", "")), normalize(svc.get("label", ""))}:
                return svc
        return None

    def parse(self, filename: str) -> dict:
        stem, ext = os.path.splitext(filename)
        ext = ext.lower()
        if ext not in VIDEO_EXTS | IMAGE_EXTS:
            raise ParseError(
                f"Extension « {ext or '(aucune)'} » non prise en charge. "
                f"Vidéos : {', '.join(sorted(VIDEO_EXTS))} — Images : {', '.join(sorted(IMAGE_EXTS))}"
            )
        original = re.sub(r"\s+", " ", stem).strip()
        norm = normalize(original)  # même longueur que original

        for ftype, rx in self.PREFIXES:
            m = rx.match(norm)
            if m:
                name = original[m.start(1):m.end(1)].strip()
                if not name:
                    raise ParseError(f"Nom vide après « {TYPE_LABELS[ftype]} : »")
                self._check_ext(ftype, ext)
                result = {"type": ftype, "filename": filename, "ext": ext}
                if ftype == TYPE_COMPLETE:
                    result["couple"] = name
                else:
                    result["name"] = name
                return result

        m = self.PRESTATION_RE.match(norm)
        if m:
            self._check_ext(TYPE_PRESTATION, ext)
            return self._couple_and_service(norm[m.start(1):], original[m.start(1):], filename, ext)

        m = self.SUFFIX_RE.match(norm)
        if m and m.group("couple").strip():
            couple = original[m.start("couple"):m.end("couple")].strip(" -_:")
            kw = m.group("kw")
            rest_norm = (m.group("rest") or "").strip()
            rest_orig = original[m.start("rest"):m.end("rest")].strip() if m.group("rest") else ""
            if kw.startswith("bande") or kw == "trailer":
                ftype = TYPE_TRAILER
            elif "grand" in kw or kw == "hero":
                ftype = TYPE_HERO
            elif kw in ("poster", "affiche"):
                ftype = TYPE_POSTER
            else:
                ftype = TYPE_COMPLETE
            if ftype != TYPE_COMPLETE and rest_norm:
                kw_orig = original[m.start('kw'):m.end('kw')]
                raise ParseError(f"Texte inattendu « {rest_orig} » après « {kw_orig} ». Format attendu : {{Mariés}} {kw_orig}{ext}")
            self._check_ext(ftype, ext)
            if ftype == TYPE_COMPLETE and rest_norm:
                # « {Mariés} video complet {prestation} » → vidéo complète de la prestation
                svc = self.find_service(rest_norm)
                if svc is None:
                    key = rest_norm
                    svc = {"key": key, "label": rest_orig[:1].upper() + rest_orig[1:], "category": "Cérémonies", "auto_created": True}
                return {
                    "type": TYPE_PRESTATION,
                    "couple": couple,
                    "service": svc["key"],
                    "service_label": svc.get("label") or svc["key"],
                    "category": svc.get("category") or "Best Of",
                    "new_service": svc if svc.get("auto_created") else None,
                    "filename": filename,
                    "ext": ext,
                }
            result = {"type": ftype, "couple": couple, "name": couple, "filename": filename, "ext": ext}
            return result

        # Forme courte « {nom(s)} {prestation} » (ex: "yassina Maoulid.mp4")
        if ext in VIDEO_EXTS:
            short = self._couple_and_service(norm, original, filename, ext, strict=False)
            if short:
                return short

        raise ParseError(
            "Nomenclature non reconnue. Formats attendus : « {Mariés} video complet {prestation}.mp4 », "
            "« {Mariés} video complet.mp4 », « {Mariés} {prestation}.mp4 », « {Mariés} Poster.jpg », "
            "« {Mariés} Grand format.jpg », « {Mariés} bande annonce.mp4 » "
            "(ou l'ancienne forme « Mariage de {mariés} {prestation}.mp4 », « Poster : … »)"
        )

    def _couple_and_service(self, rest_norm: str, rest_orig: str, filename: str, ext: str, strict: bool = True) -> Optional[dict]:
        """Découpe « {mariés} {prestation} » : la prestation connue la plus longue en fin de nom gagne."""
        rest_norm = rest_norm.strip()
        rest_orig = rest_orig.strip()
        best = None
        for svc in self.services:
            for candidate in {normalize(svc.get("key", "")), normalize(svc.get("label", ""))}:
                if candidate and rest_norm.endswith(" " + candidate) and (best is None or len(candidate) > len(best[0])):
                    best = (candidate, svc)
        if not best:
            # Prestation en début de nom : « soiree Yassina.mp4 », « Mairie Yassina & Bensaid.mp4 »
            for svc in self.services:
                for candidate in {normalize(svc.get("key", "")), normalize(svc.get("label", ""))}:
                    if candidate and rest_norm.startswith(candidate + " ") and (best is None or len(candidate) > len(best[0])):
                        best = (candidate, svc)
            if best:
                candidate, svc = best
                couple = rest_orig[len(candidate):].strip(" -_:")
                if couple:
                    return self._prestation_result(couple, svc, filename, ext)
                best = None
        if not best:
            if not strict:
                return None
            known = ", ".join(s.get("key", "") for s in self.services)
            raise ParseError(
                "Prestation non reconnue à la fin du nom. Format attendu : "
                f"{{mariés}} {{prestation}}{ext} — prestations connues : {known}"
            )
        candidate, svc = best
        couple = rest_orig[: len(rest_norm) - len(candidate)].strip(" -_:")
        if not couple:
            if not strict:
                return None
            raise ParseError(f"Nom des mariés manquant. Format attendu : {{mariés}} {{prestation}}{ext}")
        return self._prestation_result(couple, svc, filename, ext)

    def _prestation_result(self, couple: str, svc: dict, filename: str, ext: str) -> dict:
        return {
            "type": TYPE_PRESTATION,
            "couple": couple,
            "service": svc["key"],
            "service_label": svc.get("label") or svc["key"],
            "category": svc.get("category") or "Best Of",
            "filename": filename,
            "ext": ext,
        }

    @staticmethod
    def _check_ext(ftype: str, ext: str):
        if ftype in (TYPE_POSTER, TYPE_HERO) and ext not in IMAGE_EXTS:
            raise ParseError(f"{TYPE_LABELS[ftype]} : une image est attendue ({', '.join(sorted(IMAGE_EXTS))})")
        if ftype in (TYPE_PRESTATION, TYPE_COMPLETE, TYPE_TRAILER) and ext not in VIDEO_EXTS:
            raise ParseError(f"{TYPE_LABELS[ftype]} : une vidéo est attendue ({', '.join(sorted(VIDEO_EXTS))})")


# ----------------------------------------------------------------------------
# Helpers fichiers
# ----------------------------------------------------------------------------
def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def probe_duration_minutes(path: Path) -> int:
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
            capture_output=True, text=True, timeout=60,
        )
        secs = float((r.stdout or "0").strip() or 0)
        return int(round(secs / 60)) if secs > 0 else 0
    except Exception:
        return 0


def can_open(path: Path) -> bool:
    try:
        with open(path, "rb") as f:
            f.read(1)
        return True
    except Exception:
        return False


# ----------------------------------------------------------------------------
# IMPORTER
# ----------------------------------------------------------------------------
class AutoImporter:
    def __init__(self, db, upload_dir: Path, drop_dir: Path, public_url: str, slugify):
        self.db = db
        self.upload_dir = upload_dir
        self.drop_dir = drop_dir
        self.errors_dir = drop_dir / "errors"
        self.duplicates_dir = drop_dir / "duplicates"
        self.public_url = (public_url or "").rstrip("/")
        self.slugify = slugify
        self._lock = asyncio.Lock()
        self._seen: dict[str, tuple[int, float, float]] = {}  # filename -> (size, mtime, last_change_ts)
        self._task: Optional[asyncio.Task] = None
        self._lock_fd: Optional[int] = None
        self.last_scan_at: Optional[datetime] = None
        for d in (self.drop_dir, self.errors_dir, self.duplicates_dir):
            d.mkdir(parents=True, exist_ok=True)

    # ---------------- settings ----------------
    async def get_settings(self) -> dict:
        doc = await self.db.app_settings.find_one({"key": "auto_import"}, {"_id": 0, "value": 1})
        cfg = dict(DEFAULT_SETTINGS)
        cfg["services"] = [dict(s) for s in DEFAULT_SETTINGS["services"]]
        if doc and isinstance(doc.get("value"), dict):
            v = doc["value"]
            for k in ("enabled", "default_featured", "default_showcase", "notify_email", "notify_sms"):
                if k in v:
                    cfg[k] = bool(v[k])
            for k in ("notify_email_to", "notify_phone"):
                if k in v and v[k] is not None:
                    cfg[k] = str(v[k]).strip()
            if v.get("notify_on") in ("all", "errors"):
                cfg["notify_on"] = v["notify_on"]
            if isinstance(v.get("services"), list) and v["services"]:
                cfg["services"] = [
                    {
                        "key": normalize(str(s.get("key", ""))),
                        "label": str(s.get("label") or s.get("key", "")).strip(),
                        "category": s.get("category") if s.get("category") in CATEGORIES else "Best Of",
                    }
                    for s in v["services"] if s.get("key")
                ]
        return cfg

    async def save_settings(self, cfg: dict) -> dict:
        await self.db.app_settings.update_one(
            {"key": "auto_import"},
            {"$set": {"key": "auto_import", "value": cfg, "updated_at": utcnow()}},
            upsert=True,
        )
        return await self.get_settings()

    # ---------------- watcher ----------------
    def start(self):
        if not self._task:
            self._task = asyncio.create_task(self._loop())

    async def stop(self):
        if self._task:
            self._task.cancel()
            self._task = None

    async def on_startup(self):
        # Un seul processus (uvicorn --workers N) doit exécuter le watcher : verrou fichier exclusif
        self._lock_fd = os.open(str(self.drop_dir / ".watcher.lock"), os.O_CREAT | os.O_RDWR, 0o644)
        try:
            fcntl.flock(self._lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError:
            os.close(self._lock_fd)
            self._lock_fd = None
            log.info("[auto-import] Watcher déjà actif dans un autre worker — ce processus ne surveille pas ftp_drop")
            return
        # Reprise après redémarrage : les jobs restés en PROCESSING repartent en PENDING
        res = await self.db.import_jobs.update_many(
            {"status": STATUS_PROCESSING},
            {"$set": {"status": STATUS_PENDING, "message": "Reprise après redémarrage", "updated_at": utcnow()}},
        )
        if res.modified_count:
            log.info("[auto-import] %s job(s) repris après redémarrage", res.modified_count)
        await self.db.import_jobs.create_index("id", unique=True)
        await self.db.import_jobs.create_index("sha256")
        await self.db.import_jobs.create_index("status")
        self.start()

    @property
    def is_watcher(self) -> bool:
        return self._lock_fd is not None

    def _other_worker_holds_lock(self) -> bool:
        try:
            fd = os.open(str(self.drop_dir / ".watcher.lock"), os.O_CREAT | os.O_RDWR, 0o644)
        except OSError:
            return False
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(fd, fcntl.LOCK_UN)
            return False
        except OSError:
            return True
        finally:
            os.close(fd)

    async def _loop(self):
        log.info("[auto-import] Watcher démarré sur %s (scan %.0fs, stabilité %.0fs)", self.drop_dir, SCAN_INTERVAL_SECONDS, STABLE_SECONDS)
        while True:
            try:
                await self.scan()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # ne jamais tuer la boucle
                log.exception("[auto-import] Erreur de scan: %s", e)
            await asyncio.sleep(SCAN_INTERVAL_SECONDS)

    def _list_drop_files(self) -> list[Path]:
        files = []
        for f in self.drop_dir.iterdir():
            if not f.is_file() or f.name.startswith("."):
                continue
            if f.name.lower().endswith(PARTIAL_SUFFIXES):
                continue
            files.append(f)
        files.sort(key=lambda p: p.stat().st_mtime)
        return files

    async def scan(self, force: bool = False) -> dict:
        """Un passage du watcher : détecte les fichiers stables et les traite un par un (file d'attente)."""
        if not self.is_watcher:
            # Autre worker uvicorn : le watcher tourne ailleurs, on ne traite rien ici
            try:
                waiting = len(self._list_drop_files())
            except Exception:
                waiting = 0
            return {"processed": 0, "waiting": waiting, "delegated": True}
        async with self._lock:
            self.last_scan_at = utcnow()
            try:
                os.utime(self.drop_dir / ".watcher.lock", None)
            except Exception:
                pass
            now = asyncio.get_event_loop().time()
            cfg = await self.get_settings()
            processed = 0
            waiting = 0
            if not cfg.get("enabled", True):
                return {"processed": 0, "waiting": 0, "disabled": True}
            files = self._list_drop_files()
            current_names = {f.name for f in files}
            for name in list(self._seen):
                if name not in current_names:
                    self._seen.pop(name, None)
            for f in files:
                try:
                    st = f.stat()
                except FileNotFoundError:
                    continue
                size, mtime = st.st_size, st.st_mtime
                prev = self._seen.get(f.name)
                if not prev or prev[0] != size or prev[1] != mtime:
                    self._seen[f.name] = (size, mtime, now)
                    waiting += 1
                    continue
                # Fichier en attente d'un mariage (déjà journalisé, reste dans ftp_drop)
                # Fichier déjà journalisé et laissé en place (en attente d'un mariage, ou nom invalide) → on ne le retraite pas
                pending = await self.db.import_jobs.find_one(
                    {"filename": f.name, "size": size, "status": {"$in": [STATUS_PENDING, STATUS_ERROR]}, "file_location": "ftp_drop"},
                    {"_id": 0, "id": 1},
                )
                if pending:
                    continue
                if not force and (now - prev[2]) < STABLE_SECONDS:
                    waiting += 1
                    continue
                if size == 0 or not can_open(f):
                    waiting += 1
                    continue
                await self._process_file(f, cfg)
                processed += 1
            # Médias en attente : re-tenter l'association (le mariage a pu être créé depuis l'admin)
            if await self.db.import_jobs.count_documents({"status": STATUS_PENDING, "file_location": "ftp_drop"}):
                await self._attach_pending(cfg)
            return {"processed": processed, "waiting": waiting}

    # ---------------- jobs ----------------
    async def _job_set(self, job_id: str, **fields):
        fields["updated_at"] = utcnow()
        await self.db.import_jobs.update_one({"id": job_id}, {"$set": fields})
        if fields.get("status") in (STATUS_PROCESSED, STATUS_ERROR) and fields.get("result") != "duplicate":
            job = await self.db.import_jobs.find_one({"id": job_id}, {"_id": 0})
            if job:
                asyncio.create_task(self._notify(job))

    async def _notify(self, job: dict):
        """Alerte admin (email et/ou SMS Brevo) : fichier publié ou en erreur. Ne bloque jamais le pipeline."""
        try:
            cfg = await self.get_settings()
            is_error = job.get("status") == STATUS_ERROR
            if cfg.get("notify_on") == "errors" and not is_error:
                return
            wedding = job.get("client_name") or job.get("couple") or "—"
            what = job.get("type_label") or "Fichier"
            if job.get("service_label"):
                what += f" « {job['service_label']} »"
            if is_error:
                title = "❌ Import automatique — ERREUR"
                line = f"{job['filename']} → {job.get('error_message') or 'erreur'}"
                sms = f"CINEMARIES: ERREUR import {job['filename'][:60]} - {(job.get('error_message') or '')[:70]}"
            else:
                title = "✅ Import automatique — publié"
                line = f"{job['filename']} → {what} · Mariage : {wedding} · {job.get('message') or ''}"
                sms = f"CINEMARIES: publie {what} - {wedding} ({job['filename'][:50]})"
            if cfg.get("notify_email") and cfg.get("notify_email_to") and smtp_configured():
                html = render_email(
                    title,
                    f"<p><b>Fichier :</b> {job['filename']}</p><p><b>Type :</b> {what}</p><p><b>Mariage :</b> {wedding}</p>"
                    f"<p><b>Statut :</b> {job.get('status')}</p><p>{job.get('error_message') or job.get('message') or ''}</p>",
                    cta_label="Ouvrir le journal d'importation",
                    cta_url=f"{self.public_url or 'https://cinemaries.fr'}/admin/auto-import",
                )
                try:
                    await send_email(cfg["notify_email_to"], f"CINÉMARIÉS — {title}", html)
                except Exception as e:
                    log.warning("[auto-import] Email d'alerte impossible: %s", e)
            if cfg.get("notify_sms") and cfg.get("notify_phone"):
                phone = normalize_fr_phone(cfg["notify_phone"])
                if phone:
                    ok, info = await send_brevo_sms(phone, sms[:160], tag="auto_import")
                    if not ok:
                        log.warning("[auto-import] SMS d'alerte impossible: %s", info)
            log.info("[auto-import] Alerte envoyée: %s", line)
        except Exception as e:
            log.warning("[auto-import] Notification ignorée: %s", e)

    async def _new_job(self, path: Path, size: int) -> dict:
        job = {
            "id": str(uuid.uuid4()),
            "filename": path.name,
            "size": size,
            "sha256": None,
            "type": None,
            "type_label": None,
            "couple": None,
            "service": None,
            "service_label": None,
            "client_id": None,
            "client_name": None,
            "video_id": None,
            "status": STATUS_PROCESSING,
            "message": None,
            "error_message": None,
            "file_location": "ftp_drop",
            "stored_as": None,
            "url": None,
            "created_at": utcnow(),
            "updated_at": utcnow(),
            "processed_at": None,
        }
        await self.db.import_jobs.insert_one(dict(job))
        return job

    async def _process_file(self, path: Path, cfg: dict):
        size = path.stat().st_size
        # Un job PENDING (attente mariage) pour ce fichier peut exister → on le réutilise
        job = await self.db.import_jobs.find_one({"filename": path.name, "size": size, "status": STATUS_PENDING}, {"_id": 0})
        if job:
            await self._job_set(job["id"], status=STATUS_PROCESSING)
        else:
            job = await self._new_job(path, size)
        job_id = job["id"]
        log.info("[auto-import] Traitement de « %s » (%d octets)", path.name, size)
        try:
            parser = MarriageFilenameParser(cfg.get("services") or [])
            parsed = parser.parse(path.name)
            await self._job_set(
                job_id, type=parsed["type"], type_label=TYPE_LABELS[parsed["type"]],
                couple=parsed.get("couple") or parsed.get("name"),
                service=parsed.get("service"), service_label=parsed.get("service_label"),
            )

            sha = job.get("sha256") or await asyncio.to_thread(sha256_file, path)
            await self._job_set(job_id, sha256=sha)

            dup = await self.db.import_jobs.find_one(
                {"sha256": sha, "id": {"$ne": job_id}, "status": {"$in": [STATUS_PROCESSED, STATUS_PENDING]}},
                {"_id": 0},
            )
            if dup:
                dst = self._unique_dest(self.duplicates_dir, path.name)
                shutil.move(str(path), str(dst))
                when = dup.get("processed_at") or dup.get("created_at")
                when_s = when.strftime("%d/%m/%Y %H:%M") if isinstance(when, datetime) else "?"
                await self._job_set(
                    job_id, status=STATUS_PROCESSED, result="duplicate", file_location="duplicates",
                    client_id=dup.get("client_id"), client_name=dup.get("client_name"),
                    message=f"Doublon ignoré : fichier identique à « {dup['filename']} » (importé le {when_s}). Déplacé dans duplicates/.",
                    processed_at=utcnow(),
                )
                log.info("[auto-import] Doublon ignoré: %s", path.name)
                return

            if parsed["type"] in (TYPE_PRESTATION, TYPE_COMPLETE) or parsed.get("couple"):
                client_id, client_name, created = await self._find_or_create_wedding(parsed["couple"], cfg)
                await self._job_set(job_id, client_id=client_id, client_name=client_name, couple=client_name)
                if parsed.get("new_service"):
                    await self._register_service(cfg, parsed["new_service"])
                if parsed["type"] == TYPE_COMPLETE:
                    await self._apply_complete_video(job_id, path, client_id, client_name, created)
                elif parsed["type"] == TYPE_PRESTATION:
                    await self._apply_prestation(job_id, path, parsed, client_id, client_name, cfg, created)
                else:
                    await self._apply_media(job_id, path, parsed["type"], client_id, client_name, created)
                # Le mariage est maintenant connu → rattacher les médias en attente
                await self._attach_pending(cfg)
            else:
                wedding = await self._match_wedding_for_media(parsed["name"])
                if wedding is None:
                    await self._job_set(
                        job_id, status=STATUS_PENDING, file_location="ftp_drop",
                        message=f"En attente du mariage correspondant à « {parsed['name']} » (déposez la vidéo « Mariage de … » ou « Video complete : … »).",
                    )
                    log.info("[auto-import] En attente de mariage: %s", path.name)
                    return
                if wedding == "ambiguous":
                    await self._job_set(
                        job_id, status=STATUS_PENDING, file_location="ftp_drop",
                        message=f"Plusieurs mariages correspondent à « {parsed['name']} ». Renommez le fichier avec le nom complet des mariés.",
                    )
                    return
                client_id, client_name = wedding
                await self._job_set(job_id, client_id=client_id, client_name=client_name)
                await self._apply_media(job_id, path, parsed["type"], client_id, client_name)
        except ParseError as e:
            await self._fail(job_id, path, str(e))
        except Exception as e:
            log.exception("[auto-import] Erreur sur %s", path.name)
            await self._fail(job_id, path, f"Erreur interne : {e}")

    async def _fail(self, job_id: str, path: Path, message: str):
        """Statut ERROR. Le fichier reste en place dans ftp_drop (jamais supprimé ni déplacé) :
        il reste utilisable par l'import manuel de l'admin, et un renommage/redépôt le relance."""
        await self._job_set(job_id, status=STATUS_ERROR, error_message=message, file_location="ftp_drop", processed_at=utcnow())
        log.warning("[auto-import] ERROR %s: %s", path.name, message)

    @staticmethod
    def _unique_dest(folder: Path, name: str) -> Path:
        dst = folder / name
        if not dst.exists():
            return dst
        stem, ext = os.path.splitext(name)
        return folder / f"{stem} ({utcnow().strftime('%Y%m%d-%H%M%S')}){ext}"

    # ---------------- stockage (identique à l'import FTP manuel) ----------------
    def _store(self, path: Path) -> tuple[str, str]:
        new_name = f"{uuid.uuid4().hex}{path.suffix.lower()}"
        dst = self.upload_dir / new_name
        shutil.move(str(path), str(dst))
        url = f"{self.public_url}/api/uploads/{new_name}" if self.public_url else f"/api/uploads/{new_name}"
        return new_name, url

    # ---------------- mariages ----------------
    async def _list_weddings(self) -> list[dict]:
        videos = await self.db.videos.find({}, {"_id": 0, "id": 1, "title": 1, "client_id": 1, "client_name": 1, "created_at": 1}).to_list(5000)
        groups: dict[str, dict] = {}
        for v in videos:
            cid = v.get("client_id") or self.slugify(v.get("title", ""))
            g = groups.setdefault(cid, {"client_id": cid, "client_name": v.get("client_name") or v.get("title", ""), "created_at": v.get("created_at")})
            if v.get("created_at") and g.get("created_at") and v["created_at"] > g["created_at"]:
                g["created_at"] = v["created_at"]
        return list(groups.values())

    async def _find_wedding(self, couple: str) -> Optional[tuple[str, str]]:
        key = couple_key(couple)
        slug = self.slugify(couple)
        weddings = await self._list_weddings()
        for w in weddings:
            if w["client_id"] == slug or couple_key(w["client_name"]) == key or couple_key(w["client_id"]) == key:
                return w["client_id"], w["client_name"]
        # Tolérance aux fautes de frappe (« Yasinna & Bensaid » ≈ « Yassina & Bensaid »)
        best, best_ratio = None, 0.0
        for w in weddings:
            for other in {couple_key(w["client_name"]), couple_key(w["client_id"])}:
                if len(key) >= 8 and len(other) >= 8:
                    ratio = SequenceMatcher(None, key, other).ratio()
                    if ratio > best_ratio:
                        best, best_ratio = w, ratio
        if best and best_ratio >= FUZZY_THRESHOLD:
            log.info("[auto-import] Correspondance approximative « %s » → « %s » (%.2f)", couple, best["client_name"], best_ratio)
            return best["client_id"], best["client_name"]
        return None

    async def _find_or_create_wedding(self, couple: str, cfg: dict) -> tuple[str, str, bool]:
        match = await self._match_wedding_for_media(couple)
        if isinstance(match, tuple):
            return match[0], match[1], False
        if match == "ambiguous":
            names = ", ".join(w["client_name"] for w in await self._candidates_for_name(couple))
            raise ParseError(f"Plusieurs mariages correspondent à « {couple} » : {names}. Renommez le fichier avec le nom complet des mariés.")
        client_id = self.slugify(couple)
        meta = await self.db.wedding_meta.find_one({"client_id": client_id}, {"_id": 0})
        doc = {
            "id": str(uuid.uuid4()),
            "title": couple,
            "description": "",
            "category": MAIN_CATEGORY,
            "poster_url": (meta or {}).get("poster_url") or "",
            "hero_url": (meta or {}).get("hero_url") or "",
            "trailer_url": "",
            "full_url": "",
            "duration_minutes": 0,
            "is_featured": bool(cfg.get("default_featured", True)),
            "is_top_france": False,
            "is_showcase": bool(cfg.get("default_showcase", False)),
            "is_private": True,
            "client_id": client_id,
            "client_name": couple,
            "auto_imported": True,
            "created_at": utcnow(),
        }
        await self.db.videos.insert_one(doc)
        log.info("[auto-import] Mariage créé: %s (%s)", couple, client_id)
        return client_id, couple, True

    async def _main_video(self, client_id: str) -> Optional[dict]:
        """Vidéo principale du mariage : catégorie « À l'affiche » sinon la plus ancienne."""
        v = await self.db.videos.find_one({"client_id": client_id, "category": MAIN_CATEGORY}, {"_id": 0}, sort=[("created_at", 1)])
        if v:
            return v
        return await self.db.videos.find_one({"client_id": client_id}, {"_id": 0}, sort=[("created_at", 1)])

    async def _candidates_for_name(self, name: str) -> list[dict]:
        """Mariages dont le nom contient tous les prénoms du fichier (ou inversement).
        « yassina » ⊂ « Yassina & Bensaid » ✓ · « Sofie & Mohamed Oukoumbi » ⊃ « Sofie & Mohamed » ✓
        « Yassina & Bensaid » vs « Yassina & Karim » ✗ (couples différents)."""
        name_toks = {t for t in tokens(name) if t not in GENERIC_WORDS and len(t) >= 3}
        if not name_toks:
            return []
        out = []
        for w in await self._list_weddings():
            w_toks = {t for t in set(tokens(w["client_name"])) | set(tokens(w["client_id"])) if t not in {"et", "and"}}
            if name_toks <= w_toks or (w_toks and w_toks <= name_toks):
                out.append(w)
        return out

    async def _match_wedding_for_media(self, name: str):
        """Associe un fichier à un mariage à partir d'un nom complet ou partiel (prénom seul).
        Retourne (client_id, client_name), None (aucun) ou "ambiguous"."""
        exact = await self._find_wedding(name)
        if exact:
            return exact
        candidates = await self._candidates_for_name(name)
        if not candidates:
            return None
        if len(candidates) == 1:
            return candidates[0]["client_id"], candidates[0]["client_name"]
        # Plusieurs candidats → privilégier le mariage le plus récemment importé
        cids = [c["client_id"] for c in candidates]
        recent = await self.db.import_jobs.find_one(
            {"client_id": {"$in": cids}, "status": STATUS_PROCESSED},
            {"_id": 0, "client_id": 1}, sort=[("processed_at", -1)],
        )
        if recent:
            w = next(c for c in candidates if c["client_id"] == recent["client_id"])
            return w["client_id"], w["client_name"]
        return "ambiguous"

    # ---------------- application des médias ----------------
    async def _apply_complete_video(self, job_id: str, path: Path, client_id: str, client_name: str, created: bool):
        main = await self._main_video(client_id)
        duration = await asyncio.to_thread(probe_duration_minutes, path)
        stored_as, url = self._store(path)
        update = {"full_url": url, "updated_at": utcnow()}
        if duration:
            update["duration_minutes"] = duration
        replaced = bool(main.get("full_url"))
        await self.db.videos.update_one({"id": main["id"]}, {"$set": update})
        msg = ("Mariage créé et " if created else "") + ("vidéo complète remplacée" if replaced else "vidéo complète ajoutée") + " (publiée, accès privé)."
        await self._job_set(job_id, status=STATUS_PROCESSED, result="created_wedding" if created else "updated",
                            video_id=main["id"], stored_as=stored_as, url=url, file_location="uploads",
                            message=msg.capitalize(), processed_at=utcnow())
        log.info("[auto-import] Vidéo complète → %s", client_name)

    async def _apply_prestation(self, job_id: str, path: Path, parsed: dict, client_id: str, client_name: str, cfg: dict, created: bool):
        main = await self._main_video(client_id)
        duration = await asyncio.to_thread(probe_duration_minutes, path)
        stored_as, url = self._store(path)
        label = parsed["service_label"]
        existing = await self.db.videos.find_one(
            {"client_id": client_id, "$or": [{"import_service": parsed["service"]}, {"title": {"$regex": f"^{re.escape(label)}$", "$options": "i"}}]},
            {"_id": 0},
        )
        if existing:
            update = {"full_url": url, "import_service": parsed["service"], "updated_at": utcnow()}
            if duration:
                update["duration_minutes"] = duration
            await self.db.videos.update_one({"id": existing["id"]}, {"$set": update})
            video_id, msg = existing["id"], f"Prestation « {label} » mise à jour (nouvelle vidéo)."
        else:
            doc = {
                "id": str(uuid.uuid4()),
                "title": label,
                "description": "",
                "category": parsed["category"],
                "poster_url": main.get("poster_url") or "",
                "hero_url": main.get("hero_url") or main.get("poster_url") or "",
                "trailer_url": "",
                "full_url": url,
                "duration_minutes": duration,
                "is_featured": False,
                "is_top_france": False,
                "is_showcase": False,
                "is_private": True,
                "client_id": client_id,
                "client_name": client_name,
                "import_service": parsed["service"],
                "auto_imported": True,
                "created_at": utcnow(),
            }
            await self.db.videos.insert_one(doc)
            video_id, msg = doc["id"], f"Prestation « {label} » ajoutée et publiée (accès privé)."
        if created:
            msg = "Mariage créé. " + msg
        await self._job_set(job_id, status=STATUS_PROCESSED, result="created_wedding" if created else "updated",
                            video_id=video_id, stored_as=stored_as, url=url, file_location="uploads",
                            message=msg, processed_at=utcnow())
        log.info("[auto-import] Prestation %s → %s", label, client_name)

    async def _apply_media(self, job_id: str, path: Path, ftype: str, client_id: str, client_name: str, created: bool = False):
        main = await self._main_video(client_id)
        stored_as, url = self._store(path)
        now = utcnow()
        if ftype == TYPE_POSTER:
            await self.db.videos.update_one({"id": main["id"]}, {"$set": {"poster_url": url, "updated_at": now}})
            # les vidéos de prestation sans poster héritent du poster du mariage
            await self.db.videos.update_many({"client_id": client_id, "poster_url": {"$in": ["", None]}}, {"$set": {"poster_url": url}})
            await self.db.wedding_meta.update_one({"client_id": client_id}, {"$set": {"client_id": client_id, "poster_url": url, "updated_at": now}}, upsert=True)
            msg = "Poster du mariage mis à jour."
        elif ftype == TYPE_HERO:
            await self.db.videos.update_one({"id": main["id"]}, {"$set": {"hero_url": url, "updated_at": now}})
            await self.db.videos.update_many({"client_id": client_id, "hero_url": {"$in": ["", None]}}, {"$set": {"hero_url": url}})
            await self.db.wedding_meta.update_one({"client_id": client_id}, {"$set": {"client_id": client_id, "hero_url": url, "updated_at": now}}, upsert=True)
            msg = "Hero grand format du mariage mis à jour."
        else:
            await self.db.videos.update_one({"id": main["id"]}, {"$set": {"trailer_url": url, "updated_at": now}})
            msg = "Bande-annonce publiée (publique)."
        if created:
            msg = "Mariage créé. " + msg
        await self._job_set(job_id, status=STATUS_PROCESSED, result="created_wedding" if created else "updated", video_id=main["id"], stored_as=stored_as,
                            url=url, file_location="uploads", message=msg, processed_at=now)
        log.info("[auto-import] %s → %s", TYPE_LABELS[ftype], client_name)

    async def _register_service(self, cfg: dict, svc: dict):
        """Ajoute automatiquement une prestation inconnue (ex: « Oukoumbi ») à la liste configurable."""
        key = normalize(svc["key"])
        if any(normalize(s.get("key", "")) == key for s in cfg.get("services", [])):
            return
        cfg["services"].append({"key": key, "label": svc.get("label") or key, "category": svc.get("category") or "Cérémonies"})
        await self.save_settings({k: v for k, v in cfg.items() if k != "categories"})
        log.info("[auto-import] Nouvelle prestation ajoutée automatiquement: %s", key)

    async def _attach_pending(self, cfg: dict):
        """Re-tente l'association des médias en attente (Poster/Hero/Bande-annonce sans mariage)."""
        pendings = await self.db.import_jobs.find(
            {"status": STATUS_PENDING, "type": {"$in": [TYPE_POSTER, TYPE_HERO, TYPE_TRAILER]}, "file_location": "ftp_drop"},
            {"_id": 0},
        ).sort("created_at", 1).to_list(500)
        for job in pendings:
            path = self.drop_dir / job["filename"]
            if not path.exists():
                await self._job_set(job["id"], status=STATUS_ERROR, error_message="Fichier en attente introuvable dans ftp_drop/", processed_at=utcnow())
                continue
            parser = MarriageFilenameParser(cfg.get("services") or [])
            try:
                parsed = parser.parse(job["filename"])
            except ParseError as e:
                await self._fail(job["id"], path, str(e))
                continue
            wedding = await self._match_wedding_for_media(parsed["name"])
            if wedding is None or wedding == "ambiguous":
                continue
            client_id, client_name = wedding
            await self._job_set(job["id"], status=STATUS_PROCESSING, client_id=client_id, client_name=client_name)
            try:
                await self._apply_media(job["id"], path, parsed["type"], client_id, client_name)
            except Exception as e:
                await self._fail(job["id"], path, f"Erreur interne : {e}")

    # ---------------- admin actions ----------------
    async def retry(self, job_id: str) -> dict:
        job = await self.db.import_jobs.find_one({"id": job_id}, {"_id": 0})
        if not job:
            raise HTTPException(status_code=404, detail="Entrée introuvable")
        cfg = await self.get_settings()
        if job["status"] == STATUS_ERROR:
            src = self.errors_dir / job["filename"]
            if job.get("file_location") == "errors" and src.exists():
                dst = self.drop_dir / job["filename"]
                if dst.exists():
                    raise HTTPException(status_code=409, detail="Un fichier du même nom est déjà présent dans ftp_drop/")
                shutil.move(str(src), str(dst))
            elif not (self.drop_dir / job["filename"]).exists():
                raise HTTPException(status_code=400, detail="Fichier introuvable dans ftp_drop/ — redéposez-le via FileZilla.")
            await self.db.import_jobs.delete_one({"id": job_id})
            self._seen.pop(job["filename"], None)
            if not self.is_watcher:
                return {"ok": True, "queued": True}
            async with self._lock:
                path = self.drop_dir / job["filename"]
                if path.exists():
                    await self._process_file(path, cfg)
            return {"ok": True, "retried": True}
        if job["status"] == STATUS_PENDING:
            if not self.is_watcher:
                return {"ok": True, "queued": True}
            async with self._lock:
                await self._attach_pending(cfg)
            return {"ok": True, "retried": True}
        raise HTTPException(status_code=400, detail="Seuls les fichiers en erreur ou en attente peuvent être relancés")

    async def stats(self) -> dict:
        pipeline = [{"$group": {"_id": "$status", "n": {"$sum": 1}}}]
        counts = {r["_id"]: r["n"] for r in await self.db.import_jobs.aggregate(pipeline).to_list(10)}
        dup = await self.db.import_jobs.count_documents({"result": "duplicate"})
        try:
            in_folder = len(self._list_drop_files())
        except Exception:
            in_folder = 0
        running = bool(self._task and not self._task.done()) if self.is_watcher else self._other_worker_holds_lock()
        last_scan = self.last_scan_at
        try:
            last_scan = datetime.fromtimestamp((self.drop_dir / ".watcher.lock").stat().st_mtime, tz=timezone.utc)
        except Exception:
            pass
        return {
            "pending": counts.get(STATUS_PENDING, 0),
            "processing": counts.get(STATUS_PROCESSING, 0),
            "processed": counts.get(STATUS_PROCESSED, 0),
            "errors": counts.get(STATUS_ERROR, 0),
            "duplicates": dup,
            "files_in_drop": in_folder,
            "watcher_running": running,
            "last_scan_at": last_scan.isoformat() if last_scan else None,
            "drop_path": str(self.drop_dir),
            "scan_interval_seconds": SCAN_INTERVAL_SECONDS,
            "stable_seconds": STABLE_SECONDS,
        }


# ----------------------------------------------------------------------------
# ROUTES ADMIN
# ----------------------------------------------------------------------------
class ServiceBody(BaseModel):
    key: str
    label: Optional[str] = None
    category: Optional[str] = "Best Of"


class SettingsBody(BaseModel):
    enabled: Optional[bool] = None
    default_featured: Optional[bool] = None
    default_showcase: Optional[bool] = None
    notify_email: Optional[bool] = None
    notify_email_to: Optional[str] = None
    notify_sms: Optional[bool] = None
    notify_phone: Optional[str] = None
    notify_on: Optional[str] = None
    services: Optional[list[ServiceBody]] = None


def register_auto_import_routes(app, api_router: APIRouter, db, UPLOAD_DIR: Path, FTP_DROP_DIR: Path, APP_PUBLIC_URL: str, slugify, require_admin) -> AutoImporter:
    importer = AutoImporter(db, UPLOAD_DIR, FTP_DROP_DIR, APP_PUBLIC_URL, slugify)

    @app.on_event("startup")
    async def _auto_import_startup():
        try:
            await importer.on_startup()
        except Exception as e:
            log.exception("[auto-import] Démarrage du watcher impossible: %s", e)

    @app.on_event("shutdown")
    async def _auto_import_shutdown():
        await importer.stop()

    @api_router.get("/admin/auto-import/stats")
    async def auto_import_stats(_: dict = Depends(require_admin)):
        return await importer.stats()

    @api_router.get("/admin/auto-import/jobs")
    async def auto_import_jobs(status: Optional[str] = None, limit: int = 100, _: dict = Depends(require_admin)):
        q = {"status": status} if status and status != "all" else {}
        items = await db.import_jobs.find(q, {"_id": 0}).sort("updated_at", -1).to_list(min(max(limit, 1), 500))
        return {"items": items, "count": len(items)}

    @api_router.delete("/admin/auto-import/jobs/{job_id}")
    async def auto_import_delete_job(job_id: str, _: dict = Depends(require_admin)):
        res = await db.import_jobs.delete_one({"id": job_id})
        if not res.deleted_count:
            raise HTTPException(status_code=404, detail="Entrée introuvable")
        return {"ok": True}

    @api_router.post("/admin/auto-import/jobs/{job_id}/retry")
    async def auto_import_retry(job_id: str, _: dict = Depends(require_admin)):
        return await importer.retry(job_id)

    @api_router.post("/admin/auto-import/scan")
    async def auto_import_scan(_: dict = Depends(require_admin)):
        """Force un passage immédiat du watcher (les fichiers doivent tout de même être stables)."""
        r = await importer.scan()
        return {"ok": True, **r}

    @api_router.get("/admin/auto-import/settings")
    async def auto_import_get_settings(_: dict = Depends(require_admin)):
        cfg = await importer.get_settings()
        cfg["categories"] = CATEGORIES
        return cfg

    @api_router.put("/admin/auto-import/settings")
    async def auto_import_put_settings(body: SettingsBody, _: dict = Depends(require_admin)):
        cfg = await importer.get_settings()
        for k in ("enabled", "default_featured", "default_showcase", "notify_email", "notify_sms"):
            v = getattr(body, k)
            if v is not None:
                cfg[k] = bool(v)
        for k in ("notify_email_to", "notify_phone"):
            v = getattr(body, k)
            if v is not None:
                cfg[k] = v.strip()
        if body.notify_phone and not normalize_fr_phone(body.notify_phone):
            raise HTTPException(status_code=400, detail="Numéro de téléphone FR invalide (06XXXXXXXX ou +336XXXXXXXX)")
        if body.notify_on in ("all", "errors"):
            cfg["notify_on"] = body.notify_on
        if body.services is not None:
            services = []
            seen = set()
            for s in body.services:
                key = normalize(s.key)
                if not key or key in seen:
                    continue
                seen.add(key)
                services.append({
                    "key": key,
                    "label": (s.label or s.key).strip(),
                    "category": s.category if s.category in CATEGORIES else "Best Of",
                })
            if not services:
                raise HTTPException(status_code=400, detail="Au moins une prestation est requise")
            cfg["services"] = services
        saved = await importer.save_settings(cfg)
        saved["categories"] = CATEGORIES
        return saved

    @api_router.post("/admin/auto-import/test-notify")
    async def auto_import_test_notify(_: dict = Depends(require_admin)):
        """Envoie une alerte de test (email/SMS selon les réglages)."""
        cfg = await importer.get_settings()
        fake = {"filename": "Test & Alerte video complet soiree.mp4", "status": STATUS_PROCESSED, "type_label": "Prestation",
                "service_label": "Soirée", "client_name": "Test & Alerte", "message": "Ceci est un test d'alerte."}
        await importer._notify(fake)
        return {"ok": True, "email": bool(cfg.get("notify_email") and cfg.get("notify_email_to") and smtp_configured()),
                "sms": bool(cfg.get("notify_sms") and cfg.get("notify_phone")), "smtp_configured": smtp_configured()}

    @api_router.post("/admin/auto-import/parse-test")
    async def auto_import_parse_test(body: dict, _: dict = Depends(require_admin)):
        """Teste la nomenclature d'un nom de fichier sans rien importer."""
        cfg = await importer.get_settings()
        try:
            return {"ok": True, "parsed": MarriageFilenameParser(cfg["services"]).parse(str(body.get("filename", "")))}
        except ParseError as e:
            return {"ok": False, "error": str(e)}

    return importer

"""Test rapide bout-en-bout des livrables (local)."""
import io, json, os, sys, time, zipfile, urllib.request

BASE = "http://localhost:8001/api"


def call(method, path, body=None, token=None, raw=None, ctype="application/json"):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", ctype)
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


st, r = call("POST", "/auth/login", {"email": "admin@wedding.fr", "password": "Admin13!"})
assert st == 200, r
admin = r["token"] if "token" in r else r["access_token"]
cid = "test-livrables"
call("DELETE", f"/admin/projects/{cid}", token=admin)
st, r = call("POST", "/admin/projects", {"client_id": cid, "wedding_name": "Test & Livrables", "owner_email": "livrables@test.fr"}, token=admin)
assert st == 200, r

# compte mariés
email = f"livrables@test.fr"
call("POST", "/auth/register", {"email": email, "password": "Test1234!", "full_name": "Livrables Test", "account_type": "couple", "phone": "0611223344"})
st, r = call("POST", "/auth/login", {"email": email, "password": "Test1234!"})
assert st == 200, r
couple = r.get("token") or r.get("access_token")
st, r = call("GET", "/projects/me", token=couple)
assert r["project"]["client_id"] == cid, r

# ZIP de 5 images dans ftp_drop
from PIL import Image
drop = "/app/backend/uploads/ftp_drop"
buf = io.BytesIO()
with zipfile.ZipFile(buf, "w") as zf:
    for i in range(5):
        im = io.BytesIO(); Image.new("RGB", (600, 400), (i * 40, 80, 120)).save(im, "JPEG")
        zf.writestr(f"Mariage/IMG_{i:04d}.jpg", im.getvalue())
    zf.writestr("__MACOSX/._IMG_0000.jpg", b"junk")
    zf.writestr("Mariage/notes.txt", b"x")
open(os.path.join(drop, "Test & Livrables photos.zip"), "wb").write(buf.getvalue())

# import via admin (ZIP déjà dans ftp_drop)
st, r = call("GET", f"/admin/projects/{cid}/zip-candidates", token=admin)
assert any(i["name"].endswith("photos.zip") for i in r["items"]), r
st, r = call("POST", f"/admin/projects/{cid}/photos/import-zip", {"filename": "Test & Livrables photos.zip"}, token=admin)
assert st == 200, r
for _ in range(30):
    time.sleep(0.5)
    st, d = call("GET", f"/projects/{cid}/deliverables", token=couple)
    if d["deliverables"].get("photos", {}).get("import", {}).get("status") in ("done", "error"):
        break
print("photos:", json.dumps(d["deliverables"]["photos"], default=str)[:300])
assert d["deliverables"]["photos"]["import"]["status"] == "done", d
assert d["photos_count"] == 5, d
assert d["steps"]["photos_delivery"] == "done", d["steps"]
assert not os.path.exists(os.path.join(drop, "Test & Livrables photos.zip"))

# galerie accessible aux mariés (suivi seulement, aucune vidéo)
st, photos = call("GET", f"/weddings/{cid}/photos?page=1&per_page=50", token=couple)
assert st == 200 and len(photos) == 5, (st, photos)

# sélection > 40 refusée, sélection 3 ok
st, r = call("POST", f"/projects/{cid}/selection", {"photo_ids": [f"x{i}" for i in range(41)]}, token=couple)
assert st == 400, r
ids = [p["id"] for p in photos[:3]]
st, r = call("POST", f"/projects/{cid}/selection", {"photo_ids": ids, "note": "Merci !"}, token=couple)
assert st == 200, r
sel = r["project"]["deliverables"]["selection"]
assert sel["count"] == 3 and sel["filenames"][0].startswith("IMG_"), sel
assert next(s for s in r["project"]["steps"] if s["key"] == "photo_selection")["status"] == "done"

# sélection par liste de noms (mode lien)
st, r = call("POST", f"/projects/{cid}/selection", {"filenames_text": "IMG_0001, IMG_0002\nIMG_0003", "link": "quickconnect.to/abc"}, token=couple)
assert st == 200 and r["project"]["deliverables"]["selection"]["count"] == 3 and r["project"]["deliverables"]["selection"]["link"].startswith("https://"), r

# musique
st, r = call("POST", f"/projects/{cid}/music", {}, token=couple)
assert st == 400, r
st, r = call("POST", f"/projects/{cid}/music", {"title": "Perfect", "artist": "Ed Sheeran", "link": "https://youtu.be/x"}, token=couple)
assert st == 200 and next(s for s in r["project"]["steps"] if s["key"] == "music")["status"] == "done", r

# liens admin (Synology) + livraison
st, r = call("PATCH", f"/admin/projects/{cid}/deliverables", {"photos_link": "https://gofile.me/abc", "delivery_link": "https://gofile.me/film", "notify": False}, token=admin)
assert st == 200 and r["deliverables"]["photos"]["link"] and r["deliverables"]["delivery"]["link"], r
assert next(s for s in r["steps"] if s["key"] == "delivery")["status"] == "done"
assert r["deliverables"]["photos"]["mode"] == "gallery"  # galerie déjà importée → reste galerie

# accès refusé pour un autre utilisateur
call("POST", "/auth/register", {"email": "autre@test.fr", "password": "Test1234!", "full_name": "Autre", "account_type": "user"})
st, r = call("POST", "/auth/login", {"email": "autre@test.fr", "password": "Test1234!"})
other = r.get("token") or r.get("access_token")
st, r = call("GET", f"/projects/{cid}/deliverables", token=other)
assert st == 403, (st, r)

# téléchargement sélection admin via token : re-soumettre une sélection avec ids
call("POST", f"/projects/{cid}/selection", {"photo_ids": ids}, token=couple)
req = urllib.request.Request(f"{BASE}/admin/projects/{cid}/selection/download?token={admin}")
with urllib.request.urlopen(req) as resp:
    data = resp.read()
    assert resp.headers["Content-Type"] == "application/zip" and len(zipfile.ZipFile(io.BytesIO(data)).namelist()) == 3
print("TOUT OK")

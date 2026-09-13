"""E2E : nomenclature « {Mariés} {mot-clé} [{prestation}] » (capture utilisateur), ordre aléatoire + faute de frappe."""
import os, sys, time, json, random, urllib.request
from pathlib import Path

BASE = os.environ.get("BASE", "http://localhost:8001/api")
DROP = Path(os.environ.get("DROP", "/app/backend/uploads/ftp_drop"))


def api(path, method="GET", body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode() or "null")


TOKEN = api("/auth/login", "POST", {"email": "admin@wedding.fr", "password": "Admin13!"})["access_token"]
FAILS = []


def check(c, m):
    print(("✅ " if c else "❌ ") + m)
    if not c:
        FAILS.append(m)


files = [
    "Yassina & Bensaid bande annonce.mp4",
    "Yassina & Bensaid Grand format.jpg",
    "Yasinna & Bensaid Poster.jpg",
    "Yassina & Bensaid video complet Oukoumbi.mp4",
    "Yassina & Bensaid video complet soiree.mp4",
    "Yassina & Bensaid video complet.mp4",
]
random.shuffle(files)
print("Ordre de dépôt :", files)
for n in files:
    (DROP / n).write_bytes((n + str(random.random())).encode() * 2000)
    time.sleep(1)

t0 = time.time()
while time.time() - t0 < 120:
    js = {j["filename"]: j for j in api("/admin/auto-import/jobs?limit=500", token=TOKEN)["items"]}
    if all(n in js and js[n]["status"] in ("PROCESSED", "ERROR") for n in files):
        break
    time.sleep(3)
for n in files:
    j = js.get(n, {})
    check(j.get("status") == "PROCESSED", f"{n} → {j.get('status')} · {j.get('client_name')} · {j.get('message') or j.get('error_message')}")
cids = {js[n].get("client_id") for n in files if n in js}
check(len(cids) == 1, f"Tous rattachés au même mariage (faute de frappe tolérée) : {cids}")
cid = next(iter(cids))
vids = [v for v in api("/admin/videos", token=TOKEN)["videos"] if v["client_id"] == cid]
main = next((v for v in vids if v["category"] == "À l'affiche"), None)
check(main is not None and main["poster_url"] and main["hero_url"] and main["trailer_url"] and main["full_url"], "Vidéo principale : poster + hero + bande-annonce + vidéo complète")
check(sorted(v["title"] for v in vids if v is not main) == ["Oukoumbi", "Soirée"], f"Prestations Oukoumbi + Soirée créées : {[v['title'] for v in vids]}")
check(all(v["poster_url"] == main["poster_url"] for v in vids), "Poster hérité par les prestations")
svc = [s["key"] for s in api("/admin/auto-import/settings", token=TOKEN)["services"]]
check("oukoumbi" in svc, "Prestation oukoumbi présente dans la configuration")
print("\nRÉSULTAT :", "TOUT OK ✅" if not FAILS else f"{len(FAILS)} échec(s) ❌")
sys.exit(1 if FAILS else 0)

"""E2E local du pipeline d'import automatique (dépose des fichiers dans ftp_drop et interroge l'API admin)."""
import os, sys, time, json, urllib.request, random, threading
from pathlib import Path

BASE = os.environ.get("BASE", "http://localhost:8001/api")
DROP = Path(os.environ.get("DROP", "/app/backend/uploads/ftp_drop"))
EMAIL, PWD = os.environ.get("ADMIN_EMAIL", "admin@wedding.fr"), os.environ.get("ADMIN_PASSWORD", "Admin13!")


def api(path, method="GET", body=None, token=None):
    req = urllib.request.Request(BASE + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode() or "null")


TOKEN = api("/auth/login", "POST", {"email": EMAIL, "password": PWD})["access_token"]


def drop(name, size_kb=64, content=None):
    data = content if content is not None else (name + str(random.random())).encode() * (size_kb * 1024 // 40 + 1)
    (DROP / name).write_bytes(data)
    return data


def jobs():
    return {j["filename"]: j for j in api("/admin/auto-import/jobs?limit=500", token=TOKEN)["items"]}


def wait_for(names, status=("PROCESSED", "ERROR", "PENDING"), timeout=90):
    t0 = time.time()
    while time.time() - t0 < timeout:
        js = jobs()
        if all(n in js and js[n]["status"] in status for n in names):
            return js
        time.sleep(3)
    raise AssertionError(f"Timeout: {names} → {[(n, js.get(n, {}).get('status')) for n in names]}")


def weddings():
    return {w["client_id"]: w for w in api("/admin/weddings", token=TOKEN)["weddings"]}


def videos_of(cid):
    return [v for v in api("/admin/videos", token=TOKEN)["videos"] if v["client_id"] == cid]


def check(cond, msg):
    print(("✅ " if cond else "❌ ") + msg)
    if not cond:
        FAILS.append(msg)


FAILS = []
CID = "sofie-mohamed-oukoumbi"

print("== TEST 3 : le Poster arrive en premier (doit rester en attente)")
drop("Poster : Portrait Sofie.jpg")
js = wait_for(["Poster : Portrait Sofie.jpg"])
check(js["Poster : Portrait Sofie.jpg"]["status"] == "PENDING", "Poster en PENDING (aucun mariage)")

print("== TEST 2 : la vidéo de prestation arrive → création du mariage + rattachement du poster")
drop("Mariage de Sofie & Mohamed Oukoumbi soiree.mp4")
js = wait_for(["Mariage de Sofie & Mohamed Oukoumbi soiree.mp4", "Poster : Portrait Sofie.jpg"], status=("PROCESSED", "ERROR"))
check(js["Mariage de Sofie & Mohamed Oukoumbi soiree.mp4"]["status"] == "PROCESSED", "Prestation soiree PROCESSED")
check(js["Poster : Portrait Sofie.jpg"]["status"] == "PROCESSED" and js["Poster : Portrait Sofie.jpg"]["client_id"] == CID, "Poster rattaché automatiquement au mariage")
w = weddings()
check(CID in w and w[CID]["client_name"] == "Sofie & Mohamed Oukoumbi", "Mariage créé : Sofie & Mohamed Oukoumbi")
vids = videos_of(CID)
check(len(vids) == 2, f"2 vidéos (principale + Soirée) — trouvé {len(vids)}")
main = next(v for v in vids if v["category"] == "À l'affiche")
soiree = next(v for v in vids if v["title"] == "Soirée")
check(main["poster_url"].endswith(".jpg") and soiree["poster_url"] == main["poster_url"], "Poster appliqué à la vidéo principale et hérité par la prestation")
check(soiree["full_url"].endswith(".mp4") and soiree["category"] == "Soirées", "Prestation Soirée avec full_url + catégorie Soirées")

print("== TEST 1/4 : vidéo complète, hero, bande-annonce, 2e prestation déposés ensemble")
drop("Video complete : Sofie & Mohamed Oukoumbi.mp4")
drop("Hero grand format : Sofie.jpg")
drop("Bande-annonce : Sequence Sofie.mp4")
drop("Mariage de Sofie & Mohamed Oukoumbi Maoulid.mp4")
names = ["Video complete : Sofie & Mohamed Oukoumbi.mp4", "Hero grand format : Sofie.jpg", "Bande-annonce : Sequence Sofie.mp4", "Mariage de Sofie & Mohamed Oukoumbi Maoulid.mp4"]
js = wait_for(names, status=("PROCESSED", "ERROR"))
check(all(js[n]["status"] == "PROCESSED" and js[n]["client_id"] == CID for n in names), "4 fichiers PROCESSED sur le même mariage")
vids = videos_of(CID)
main = next(v for v in vids if v["category"] == "À l'affiche")
check(main["full_url"].endswith(".mp4"), "Vidéo complète → full_url de la vidéo principale")
check(main["hero_url"].endswith(".jpg") and main["hero_url"] != main["poster_url"], "Hero distinct du poster")
check(main["trailer_url"].endswith(".mp4") and main["trailer_url"] != main["full_url"], "Bande-annonce publique distincte de la vidéo complète")
check(len(vids) == 3 and any(v["title"] == "Maoulid" and v["category"] == "Cérémonies" for v in vids), "Prestation Maoulid ajoutée (3 vidéos, pas de doublon de mariage)")
check(len(weddings()) == len({k for k in weddings()}) and sum(1 for k in weddings() if "sofie" in k) == 1, "Un seul mariage Sofie & Mohamed")
pub = api("/weddings/public")
check(any(x["client_id"] == CID and x["poster_url"] and x["hero_url"] for x in pub["weddings"]), "Mariage publié dans le catalogue public avec poster + hero")

print("== TEST 6 : le même fichier est déposé deux fois (contenu identique)")
data = drop("Mariage de Sofie & Mohamed Oukoumbi ceremonie.mp4")
wait_for(["Mariage de Sofie & Mohamed Oukoumbi ceremonie.mp4"], status=("PROCESSED", "ERROR"))
drop("Mariage de Sofie & Mohamed Oukoumbi ceremonie.mp4", content=data)
time.sleep(20)
js = wait_for(["Mariage de Sofie & Mohamed Oukoumbi ceremonie.mp4"], status=("PROCESSED", "ERROR"))
dups = [j for j in api("/admin/auto-import/jobs?limit=500", token=TOKEN)["items"] if j.get("result") == "duplicate"]
check(len(dups) == 1 and dups[0]["filename"] == "Mariage de Sofie & Mohamed Oukoumbi ceremonie.mp4", "Doublon détecté par SHA-256 et ignoré")
check((DROP / "duplicates" / "Mariage de Sofie & Mohamed Oukoumbi ceremonie.mp4").exists(), "Doublon déplacé dans duplicates/")
check(sum(1 for v in videos_of(CID) if v["title"] == "Cérémonie") == 1, "Une seule vidéo Cérémonie")

print("== TEST 8 : nomenclature incorrecte")
drop("Mariage Sofie Mohamed.mp4")
js = wait_for(["Mariage Sofie Mohamed.mp4"], status=("PROCESSED", "ERROR"))
check(js["Mariage Sofie Mohamed.mp4"]["status"] == "ERROR" and "Nomenclature" in (js["Mariage Sofie Mohamed.mp4"]["error_message"] or ""), "ERROR avec message explicite")
check((DROP / "errors" / "Mariage Sofie Mohamed.mp4").exists(), "Fichier invalide déplacé dans errors/")

print("== TEST 7 : fichier encore en cours de copie (croissance pendant 30 s)")
slow = DROP / "Mariage de Sofie & Mohamed Oukoumbi reception.mp4"
stop = threading.Event()


def writer():
    with open(slow, "wb") as f:
        while not stop.is_set():
            f.write(os.urandom(4096)); f.flush(); os.fsync(f.fileno()); time.sleep(1)


th = threading.Thread(target=writer); th.start()
time.sleep(30)
check(slow.name not in jobs(), "Fichier en cours de copie NON traité pendant 30 s")
stop.set(); th.join()
js = wait_for([slow.name], status=("PROCESSED", "ERROR"))
check(js[slow.name]["status"] == "PROCESSED", "Fichier traité une fois la copie terminée")

print("== TEST 9 + 5 : deuxième mariage, ordre aléatoire")
files2 = ["Hero grand format : Amina.jpg", "Bande-annonce : Sequence Karim.mp4", "Vidéo complète : Amina et Karim Benali.mp4", "Poster : Portrait Karim.jpg", "Mariage de Amina et Karim Benali henne.mp4"]
random.shuffle(files2)
for n in files2:
    drop(n); time.sleep(2)
js = wait_for(files2, status=("PROCESSED", "ERROR"), timeout=150)
CID2 = "amina-et-karim-benali"
check(all(js[n]["status"] == "PROCESSED" and js[n]["client_id"] == CID2 for n in files2), "2e mariage : 5 fichiers rattachés à Amina et Karim Benali")
v2 = videos_of(CID2)
m2 = next(v for v in v2 if v["category"] == "À l'affiche")
check(len(v2) == 2 and m2["poster_url"] and m2["hero_url"] and m2["trailer_url"] and m2["full_url"], "2e mariage complet (poster/hero/trailer/full + Henné)")
check(len(videos_of(CID)) == 5, "1er mariage intact (5 vidéos)")

print("== TEST 10/11/12 : mariage existant reçoit nouvelle prestation, nouvelle vidéo complète, nouveau poster")
old_full = m2["full_url"]; old_poster = m2["poster_url"]
drop("Mariage de Amina & Karim Benali soiree.mp4"); drop("Video complete : Amina & Karim Benali.mp4"); drop("Poster : Amina.jpg")
n3 = ["Mariage de Amina & Karim Benali soiree.mp4", "Video complete : Amina & Karim Benali.mp4", "Poster : Amina.jpg"]
js = wait_for(n3, status=("PROCESSED", "ERROR"))
check(all(js[n]["status"] == "PROCESSED" and js[n]["client_id"] == CID2 for n in n3), "Variante « & » reconnue comme le même mariage (pas de doublon)")
v2 = videos_of(CID2); m2 = next(v for v in v2 if v["category"] == "À l'affiche")
check(len(v2) == 3 and m2["full_url"] != old_full and m2["poster_url"] != old_poster, "Nouvelle prestation ajoutée, vidéo complète et poster remplacés")
check(sum(1 for k in weddings() if "amina" in k) == 1, "Un seul mariage Amina & Karim")

st = api("/admin/auto-import/stats", token=TOKEN)
print("STATS", st)
print("\nRÉSULTAT :", "TOUT OK ✅" if not FAILS else f"{len(FAILS)} échec(s) ❌ {FAILS}")
sys.exit(1 if FAILS else 0)

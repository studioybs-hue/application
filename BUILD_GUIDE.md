# 📱 Guide de build CINÉMARIÉS — App Android/iOS native avec Chromecast

## 🎯 Ce que vous allez obtenir
- ✅ **APK Android** installable sur votre téléphone (5 min de build)
- ✅ **IPA iOS** (nécessite compte Apple Developer 99€/an)
- ✅ **Chromecast natif** qui fonctionne depuis votre téléphone
- ✅ Toutes les fonctionnalités existantes (codes, hébergement, paiement Stripe)

---

## 🔧 Pré-requis sur VOTRE ordinateur

### 1. Node.js et Yarn
```bash
# Vérifier que Node 20+ est installé
node -v   # doit afficher v20.x ou plus

# Installer Yarn si nécessaire
npm install -g yarn
```

### 2. Compte Expo (GRATUIT)
- Allez sur https://expo.dev/signup
- Créez un compte avec votre email
- Notez votre **username** (ex: `creativindustry`)

### 3. EAS CLI
```bash
npm install -g eas-cli
eas --version  # doit afficher 12.x ou plus
```

---

## 🚀 Étape 1 — Récupérer le code

### Option A — Si vous avez le repo GitHub
```bash
git clone <votre-repo-cinemaries> ~/cinemaries
cd ~/cinemaries/frontend
```

### Option B — Télécharger depuis Emergent
1. Sur Emergent, cliquez sur "Save to GitHub" (en haut à droite)
2. Le code est poussé dans votre repo GitHub privé
3. Clonez-le sur votre PC :
```bash
git clone https://github.com/<votre-user>/<votre-repo>.git ~/cinemaries
cd ~/cinemaries/frontend
```

---

## 📦 Étape 2 — Installer les dépendances

```bash
yarn install
```

⏳ Prend ~2 minutes la première fois.

---

## 🔐 Étape 3 — Se connecter à Expo

```bash
eas login
# Email + mot de passe créés à l'étape précédente
```

```bash
eas init --id <projet-id-si-existant>
# OU pour créer un nouveau projet :
eas init
# → Choisissez "fr.cinemaries.app" comme bundleIdentifier
```

Cette commande va automatiquement mettre à jour `app.json` avec le bon `projectId`.

---

## 🤖 Étape 4 — Build Android (APK)

```bash
cd ~/cinemaries/frontend
eas build --profile preview --platform android
```

⏳ **Durée : 15-25 minutes** (le build se fait sur les serveurs Expo, vous pouvez fermer le terminal).

Une fois terminé, Expo vous envoie :
- Un **lien de téléchargement** par email
- Un **QR code** dans le terminal pour télécharger directement sur le téléphone

### 📲 Installation sur Android
1. Ouvrez le lien de l'APK sur votre téléphone Android
2. Autorisez "Sources inconnues" si demandé (Paramètres → Sécurité)
3. Installez l'APK
4. Lancez **CINÉMARIÉS**
5. Le bouton 📺 Cast détectera votre Chromecast nativement !

---

## 🍎 Étape 5 — Build iOS (optionnel, payant)

⚠️ **Prérequis** : Compte Apple Developer Program (**99€/an**)

```bash
eas build --profile preview --platform ios
```

EAS vous guidera pour :
- Connecter votre Apple ID
- Générer les certificats automatiquement
- Soumettre à TestFlight (test interne) ou App Store

Pour un build **simulateur** (test gratuit sur Mac) :
```bash
eas build --profile development --platform ios
```

---

## 🌐 Étape 6 — Configurer le backend URL en production

Avant de builder, ouvrez `frontend/.env` et vérifiez :
```
EXPO_PUBLIC_BACKEND_URL=https://mariagevideo.preview.emergentagent.com
```
*(ou votre domaine cinemaries.fr si vous l'avez déployé)*

L'app native pointera vers ce backend. Si vous changez de backend après le build, il faudra refaire un build.

---

## 🛠️ Commandes utiles

| Action | Commande |
|---|---|
| Voir les builds en cours | `eas build:list` |
| Re-télécharger un build | `eas build:view <build-id>` |
| Build local Android (sans Expo) | `eas build --platform android --local` (nécessite Android Studio) |
| Mettre à jour OTA (sans rebuild) | `eas update --branch preview` |
| Soumettre au Play Store | `eas submit --platform android` |
| Soumettre à App Store | `eas submit --platform ios` |

---

## 📺 Chromecast — Comment ça fonctionne sur l'APK

Une fois l'APK installé :
1. Lancez **CINÉMARIÉS**
2. Connectez-vous à un mariage (entrez votre code)
3. Lancez une vidéo
4. **Le bouton 📺 utilisera l'API Cast native Android** (la même qu'utilisent Netflix, YouTube, etc.)
5. Sélectionnez votre Chromecast / Google TV / Android TV
6. La vidéo s'affiche en streaming sur la TV

⚠️ Conditions : être sur le **même Wi-Fi** que le Chromecast.

---

## 🐛 Dépannage

### "Cannot determine eas project ID"
```bash
eas init
```

### "EAS Build is not enabled for this account"
- Vous êtes sur le plan gratuit (5 builds/mois suffisent normalement)
- Si dépassé : passez au plan EAS Production (29$/mois) sur https://expo.dev/billing

### Le Chromecast n'est pas détecté
- Vérifiez que le téléphone et le Chromecast sont sur le **même Wi-Fi**
- L'app a-t-elle bien demandé la permission **réseau local** ? (Android 12+)
- Redémarrez le Chromecast

### "Module react-native-google-cast not found"
- Vous utilisez Expo Go → il faut un EAS Build, pas Expo Go
- Re-installez l'APK que vous avez buildé

---

## 💰 Coûts récapitulatifs

| Item | Coût |
|---|---|
| EAS Build gratuit (30 builds/mois) | **0€** |
| Compte Apple Developer (pour iOS) | 99€/an |
| Compte Google Play Developer (1x) | 25€ |
| Domaine cinemaries.fr | ~12€/an |
| Hébergement backend (Emergent) | déjà inclus |
| **Total minimum (Android seulement)** | **25€** |
| **Total complet (Android + iOS)** | **136€/an** |

---

## 🎉 Résultat final

Une fois l'APK installé sur votre téléphone Android :
- 🎬 Logo CINÉMARIÉS sur l'écran d'accueil
- 📺 Bouton Cast natif fonctionnel (comme YouTube/Netflix)
- 💳 Paiement Stripe via WebView intégrée
- 🎟️ Toute la logique codes/déblocages identique au web
- ☁️ Upload de vidéos brutes par les vidéastes via le lien sécurisé
- 🔒 Authentification persistante (vous restez connecté)

Pour toute question, contactez-moi avec le message d'erreur exact !

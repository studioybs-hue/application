# Wedding Stream — PRD

## Vision
"Netflix exclusivement pour les mariages" — une plateforme de streaming premium permettant aux mariés et invités de revivre les plus beaux moments des mariages. Chaque client reçoit un code unique pour débloquer son propre film de mariage. Catalogue public (extraits/bandes-annonces) visible par tous, contenu complet réservé aux clients identifiés ou abonnés Premium.

## Cible
- Mariés (clients principaux)
- Famille et invités (via codes partagés)
- Vidéastes / sociétés de production qui distribuent les films via la plateforme

## MVP (livré)

### Authentification
- Inscription / connexion email + mot de passe (JWT bcrypt)
- Tokens stockés via Expo SecureStore (`@/src/utils/storage`)
- AuthContext global

### Catalogue public
- Page Accueil de type Netflix avec hero banner (vidéo en N°1 en France)
- Lignes horizontales par catégorie : À l'affiche, Cérémonies, Soirées, Best Of
- Posters de mariage cinématographiques
- Badge "N°1 EN FRANCE" sur la vedette

### Vidéos privées & codes uniques
- Chaque vidéo a un `trailer_url` (public) et `full_url` (privé)
- Code de déblocage à 8 caractères alphanumériques
- Écran de saisie de code stylisé
- Bibliothèque personnelle des vidéos débloquées
- Codes à usage limité / expirables côté backend

### Player vidéo
- Lecteur intégré (HTML5 via WebView mobile, balise `<video>` sur web)
- Bouton Chromecast (maquette, prêt pour V2 native TV)
- Action share / ma liste

### Abonnement Premium Stripe
- Page premium 1,99€/mois
- Stripe Checkout Session (mode subscription)
- Retour via deeplink + vérification status côté backend
- Statut `is_subscribed` sur l'utilisateur

### Design
- Thème "Jewel & Luxury" : noir profond, or champagne, bordeaux/vin
- Typo cinématographique élégante
- Animations subtiles, micro-interactions

## Architecture technique
- **Frontend** : Expo SDK 54, React Native 0.81, expo-router file-based, TypeScript
- **Backend** : FastAPI + Motor (MongoDB), JWT, bcrypt
- **Paiement** : Stripe (clé sk_test_emergent fournie par l'env)
- **Vidéo** : WebView/HTML5 (compatible Expo Go)
- **Stockage local** : `@/src/utils/storage` (SecureStore)

## Roadmap V2
- Chromecast natif (build EAS)
- Version TV (tvOS / Android TV)
- Téléchargement hors-ligne
- Dashboard vidéaste (création de codes en masse)
- Albums photos liés aux mariages
- Quality picker (1080p / 4K / HDR)
- Webhooks Stripe pour gestion proactive des abonnements

## Modèle économique
- Premium 1,99€/mois (catalogue complet + futures fonctionnalités TV)
- Codes uniques fournis par les vidéastes B2B (revenu B2B futur)
- Marketplace de vidéastes (commission sur ventes)

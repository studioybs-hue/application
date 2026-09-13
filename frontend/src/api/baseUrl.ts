import { Platform } from "react-native";

/**
 * Adresse du backend.
 *
 * - Web : URL du build (EXPO_PUBLIC_BACKEND_URL) ou chemins relatifs "/api"
 *   quand le site est servi par le même Nginx que l'API (cinemaries.fr).
 * - iOS / Android (build de production) : TOUJOURS le serveur de production
 *   cinemaries.fr, quelle que soit la variable d'environnement injectée au
 *   moment du build. Évite qu'une app publiée pointe vers un environnement
 *   de prévisualisation avec une base de données figée.
 * - Développement natif (Expo Go, __DEV__) : URL de prévisualisation.
 */
const PRODUCTION_API = "https://cinemaries.fr";

const envUrl = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");

export const BACKEND_URL: string =
  Platform.OS === "web" || __DEV__ ? envUrl : PRODUCTION_API;

/**
 * Livrables du suivi de projet (photos ZIP / lien Synology, sélection des 40 photos,
 * musique, livraison) — types + helpers partagés client / admin.
 */
import { Platform } from "react-native";
import { getToken } from "@/src/api/client";
import { BACKEND_URL } from "@/src/api/baseUrl";

export type LinkItem = { label: string; url: string };

export type SelectionUpload = {
  id: string;
  filename: string;
  original_name?: string | null;
  size?: number;
  url: string;
  thumb_url: string;
};

export type PhotosDeliverable = {
  mode?: "gallery" | "link" | null;
  link?: string | null;
  links?: LinkItem[];
  imported_count?: number;
  import?: { status: "running" | "done" | "error"; total: number; done: number; error?: string | null; filename?: string };
};

export type SelectionDeliverable = {
  photo_ids?: string[];
  filenames?: string[];
  filenames_text?: string | null;
  link?: string | null;
  note?: string | null;
  uploads?: SelectionUpload[];
  count?: number;
  submitted_at?: string | null;
};

export type MusicDeliverable = {
  title?: string | null;
  artist?: string | null;
  link?: string | null;
  note?: string | null;
  file_url?: string | null;
  file_original_name?: string | null;
  submitted_at?: string | null;
};

export type Deliverables = {
  photos?: PhotosDeliverable;
  selection?: SelectionDeliverable;
  music?: MusicDeliverable;
  delivery?: { link?: string | null; links?: LinkItem[] };
};

export const SELECTION_MAX = 40;
export const SELECTION_UPLOAD_MAX = 50;

/** Liens d'un livrable (nouveau format `links`, repli sur l'ancien `link`). */
export function linksOf(d?: { link?: string | null; links?: LinkItem[] } | null, fallbackLabel = "Télécharger"): LinkItem[] {
  if (d?.links?.length) return d.links;
  if (d?.link) return [{ label: fallbackLabel, url: d.link }];
  return [];
}

export async function openExternal(url: string) {
  if (Platform.OS === "web") {
    window.open(url, "_blank", "noopener");
    return;
  }
  const WebBrowser = await import("expo-web-browser");
  await WebBrowser.openBrowserAsync(url);
}

/** Envoi multipart authentifié (fichier audio, ZIP admin). */
export async function uploadFile(path: string, file: File | Blob, filename: string): Promise<any> {
  const token = await getToken();
  const form = new FormData();
  form.append("file", file as any, filename);
  const res = await fetch(`${BACKEND_URL}/api${path}`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!res.ok) throw new Error(data?.detail || `Erreur ${res.status}`);
  return data;
}

export function fmtDateTime(iso?: string | null): string {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

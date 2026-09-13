/**
 * Actions proposées aux mariés sous les étapes 5 / 6 / 7 / 9 du suivi de projet.
 */
import type { Router } from "expo-router";
import type { ProjectTracking, StepAction } from "./ProjectTrackingView";
import { SELECTION_MAX, fmtDateTime, openExternal } from "./deliverables";

export function buildCoupleStepActions(project: ProjectTracking, router: Router): Record<string, StepAction | undefined> {
  const d = project.deliverables || {};
  const cid = project.client_id;
  const photos = d.photos || {};
  const hasGallery = photos.mode === "gallery" || (photos.imported_count || 0) > 0;
  const photosLink = photos.link || null;
  const importing = photos.import?.status === "running";
  const actions: Record<string, StepAction | undefined> = {};

  // 5. Photos déposées
  if (importing) {
    actions.photos_delivery = {
      label: "Photos en cours de mise en ligne…",
      icon: "hourglass-outline",
      secondary: true,
      onPress: () => {},
      hint: `${photos.import?.done || 0} / ${photos.import?.total || "…"} photos`,
    };
  } else if (hasGallery) {
    actions.photos_delivery = {
      label: `Voir mes photos (${photos.imported_count || ""})`.replace(" ()", ""),
      icon: "images-outline",
      onPress: () => router.push({ pathname: "/photos/[clientId]", params: { clientId: cid } }),
      hint: photosLink ? "Un lien de téléchargement complet est aussi disponible ci-dessous." : undefined,
    };
  } else if (photosLink) {
    actions.photos_delivery = {
      label: "Télécharger mes photos",
      icon: "cloud-download-outline",
      onPress: () => openExternal(photosLink),
      hint: "Lien de téléchargement sécurisé (serveur du studio).",
    };
  }
  if (hasGallery && photosLink && actions.photos_delivery) {
    // Galerie + lien : le lien reste accessible via l'écran de sélection / galerie
    actions.photos_delivery.hint = "Lien de téléchargement complet disponible dans « Sélection ».";
  }

  // 6. Sélection des 40 photos
  const sel = d.selection || {};
  const sent = sel.submitted_at ? `Sélection envoyée le ${fmtDateTime(sel.submitted_at)} (${sel.count || 0} photos)` : undefined;
  if (hasGallery) {
    actions.photo_selection = {
      label: sent ? "Modifier ma sélection" : `Choisir mes ${SELECTION_MAX} photos`,
      icon: sent ? "checkmark-done-outline" : "heart-outline",
      secondary: !!sent,
      onPress: () => router.push({ pathname: "/photos/[clientId]", params: { clientId: cid, select: "1" } }),
      hint: sent,
    };
  } else if (photosLink || project.steps.find((s) => s.key === "photos_delivery")?.status === "done") {
    actions.photo_selection = {
      label: sent ? "Modifier ma sélection" : "Envoyer ma sélection",
      icon: sent ? "checkmark-done-outline" : "list-outline",
      secondary: !!sent,
      onPress: () => router.push({ pathname: "/projects/[clientId]/selection", params: { clientId: cid } }),
      hint: sent,
    };
  }

  // 7. Musique
  const music = d.music || {};
  const musicSent = music.submitted_at
    ? `Reçue le ${fmtDateTime(music.submitted_at)}${music.title ? ` — ${music.title}` : music.file_original_name ? ` — ${music.file_original_name}` : ""}`
    : undefined;
  actions.music = {
    label: musicSent ? "Modifier ma musique" : "Envoyer ma musique",
    icon: musicSent ? "checkmark-done-outline" : "musical-notes-outline",
    secondary: !!musicSent,
    onPress: () => router.push({ pathname: "/projects/[clientId]/music", params: { clientId: cid } }),
    hint: musicSent,
  };

  // 9. Livraison (films lourds via lien Synology)
  const deliveryLink = d.delivery?.link;
  if (deliveryLink) {
    actions.delivery = {
      label: "Télécharger mon film",
      icon: "cloud-download-outline",
      onPress: () => openExternal(deliveryLink),
      hint: "Lien de téléchargement (fichiers volumineux).",
    };
  }
  return actions;
}

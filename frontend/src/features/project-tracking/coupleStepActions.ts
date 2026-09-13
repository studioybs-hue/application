/**
 * Actions proposées aux mariés sous les étapes 5 / 6 / 7 / 9 du suivi de projet.
 */
import type { Router } from "expo-router";
import type { ProjectTracking, StepAction } from "./ProjectTrackingView";
import { SELECTION_MAX, fmtDateTime, linksOf, openExternal } from "./deliverables";

type Actions = Record<string, StepAction | StepAction[] | undefined>;

export function buildCoupleStepActions(project: ProjectTracking, router: Router): Actions {
  const d = project.deliverables || {};
  const cid = project.client_id;
  const photos = d.photos || {};
  const hasGallery = photos.mode === "gallery" || (photos.imported_count || 0) > 0;
  const photoLinks = linksOf(photos, "Télécharger mes photos");
  const importing = photos.import?.status === "running";
  const actions: Actions = {};

  // 5. Photos déposées : galerie et/ou liens de téléchargement (Synology)
  const photoActions: StepAction[] = [];
  if (importing) {
    photoActions.push({
      label: "Photos en cours de mise en ligne…",
      icon: "hourglass-outline",
      secondary: true,
      onPress: () => {},
      hint: `${photos.import?.done || 0} / ${photos.import?.total || "…"} photos`,
    });
  } else if (hasGallery) {
    photoActions.push({
      label: `Voir mes photos (${photos.imported_count || ""})`.replace(" ()", ""),
      icon: "images-outline",
      onPress: () => router.push({ pathname: "/photos/[clientId]", params: { clientId: cid } }),
    });
  }
  photoLinks.forEach((l, i) => {
    photoActions.push({
      label: photoLinks.length > 1 || hasGallery ? l.label : "Télécharger mes photos",
      icon: "cloud-download-outline",
      secondary: hasGallery,
      onPress: () => openExternal(l.url),
      hint: i === photoLinks.length - 1 && !hasGallery ? "Lien de téléchargement sécurisé (serveur du studio)." : undefined,
      testID: `project-step-link-photos-${i}`,
    });
  });
  if (photoActions.length) actions.photos_delivery = photoActions;

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
  } else if (photoLinks.length || project.steps.find((s) => s.key === "photos_delivery")?.status === "done") {
    // Photos sur le serveur du studio → les mariés nous envoient directement leurs photos choisies
    actions.photo_selection = {
      label: sent ? "Modifier mes photos envoyées" : "Envoyer mes photos choisies",
      icon: sent ? "checkmark-done-outline" : "cloud-upload-outline",
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

  // 9. Livraison (films lourds via liens Synology, un bouton par lien)
  const deliveryLinks = linksOf(d.delivery, "Télécharger mon film");
  if (deliveryLinks.length) {
    actions.delivery = deliveryLinks.map((l, i) => ({
      label: deliveryLinks.length > 1 ? l.label : "Télécharger mon film",
      icon: "cloud-download-outline",
      onPress: () => openExternal(l.url),
      hint: i === deliveryLinks.length - 1 ? "Lien de téléchargement (fichiers volumineux)." : undefined,
      testID: `project-step-link-delivery-${i}`,
    }));
  }
  return actions;
}

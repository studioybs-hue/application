/**
 * Admin — panneau « Livrables » d'un suivi de projet :
 * photos (ZIP FTP → galerie, ou lien Synology), sélection reçue, musique reçue, lien de livraison.
 */
import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, TextInput, ActivityIndicator, Modal, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import { api, getToken } from "@/src/api/client";
import { BACKEND_URL } from "@/src/api/baseUrl";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert } from "@/src/utils/dialog";
import type { ProjectTracking } from "./ProjectTrackingView";
import { fmtDateTime, openExternal, uploadFile } from "./deliverables";

type ZipItem = { name: string; size: number; modified: string };

function human(bytes: number) {
  if (bytes > 1e9) return `${(bytes / 1e9).toFixed(1)} Go`;
  if (bytes > 1e6) return `${(bytes / 1e6).toFixed(0)} Mo`;
  return `${Math.max(1, Math.round(bytes / 1e3))} Ko`;
}

export function AdminDeliverablesPanel({ project, onChanged, reload }: { project: ProjectTracking; onChanged: (p: ProjectTracking) => void; reload: () => void }) {
  const router = useRouter();
  const cid = project.client_id;
  const d = project.deliverables || {};
  const photos = d.photos || {};
  const importing = photos.import?.status === "running";
  const [photosLink, setPhotosLink] = useState(photos.link || "");
  const [deliveryLink, setDeliveryLink] = useState(d.delivery?.link || "");
  const [saving, setSaving] = useState<"" | "photos" | "delivery">("");
  const [zipModal, setZipModal] = useState(false);
  const [zips, setZips] = useState<ZipItem[] | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    setPhotosLink(photos.link || "");
    setDeliveryLink(d.delivery?.link || "");
  }, [photos.link, d.delivery?.link]);

  // Import ZIP en cours → rafraîchir toutes les 3 s
  useEffect(() => {
    if (!importing) return;
    const t = setInterval(reload, 3000);
    return () => clearInterval(t);
  }, [importing, reload]);

  const saveLinks = async (which: "photos" | "delivery") => {
    setSaving(which);
    try {
      const body = which === "photos" ? { photos_link: photosLink.trim() } : { delivery_link: deliveryLink.trim() };
      const p = await api<ProjectTracking>(`/admin/projects/${cid}/deliverables`, { method: "PATCH", body });
      onChanged(p);
      const val = which === "photos" ? photosLink.trim() : deliveryLink.trim();
      showAlert(val ? "✅ Lien enregistré" : "Lien supprimé", val ? "L'étape est passée en « Terminé » et les mariés ont été prévenus." : "Le lien n'est plus proposé aux mariés.");
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Enregistrement impossible");
    } finally {
      setSaving("");
    }
  };

  const openZipModal = async () => {
    setZipModal(true);
    setZips(null);
    try {
      const r = await api<{ items: ZipItem[] }>(`/admin/projects/${cid}/zip-candidates`);
      setZips(r.items);
    } catch (e: any) {
      setZips([]);
      showAlert("Erreur", e?.message || "Lecture du dossier FTP impossible");
    }
  };

  const importZip = async (name: string) => {
    try {
      await api(`/admin/projects/${cid}/photos/import-zip`, { method: "POST", body: { filename: name } });
      setZipModal(false);
      showAlert("📸 Import lancé", `Extraction de « ${name} » dans la galerie privée des mariés. Les mariés seront prévenus à la fin.`);
      setTimeout(reload, 800);
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Import impossible");
    }
  };

  const uploadZip = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["application/zip", "application/x-zip-compressed"], multiple: false });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      setUploading(true);
      let fileObj: File | Blob = (asset as any).file;
      if (!fileObj) fileObj = await fetch(asset.uri).then((r) => r.blob());
      await uploadFile(`/admin/projects/${cid}/photos/import-zip/upload`, fileObj, asset.name || "photos.zip");
      setZipModal(false);
      showAlert("📸 Import lancé", `« ${asset.name} » est en cours d'extraction dans la galerie.`);
      setTimeout(reload, 800);
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Envoi impossible (pour les gros ZIP, passez par le FTP)");
    } finally {
      setUploading(false);
    }
  };

  const downloadSelection = async () => {
    const token = await getToken();
    openExternal(`${BACKEND_URL}/api/admin/projects/${cid}/selection/download?token=${encodeURIComponent(token || "")}`);
  };

  const sel = d.selection;
  const music = d.music;

  return (
    <View style={styles.box} testID="admin-deliverables">
      <Text style={styles.boxTitle}>📦 Livrables & retours des mariés</Text>

      {/* ---- 5. Photos ---- */}
      <Text style={styles.section}>5 · Photos déposées</Text>
      <View style={styles.statusRow}>
        <Ionicons name="images-outline" size={14} color={colors.gold} />
        <Text style={styles.statusTxt}>
          {importing
            ? `Import en cours : ${photos.import?.done || 0} / ${photos.import?.total || "…"} (${photos.import?.filename})`
            : photos.import?.status === "error"
            ? `Dernier import en erreur : ${photos.import?.error}`
            : (photos.imported_count || 0) > 0
            ? `Galerie : ${photos.imported_count} photos en ligne`
            : "Aucune photo en galerie"}
        </Text>
        {importing ? <ActivityIndicator color={colors.gold} size="small" /> : null}
      </View>
      <View style={styles.btnRow}>
        <TouchableOpacity style={styles.btn} onPress={openZipModal} disabled={importing} testID="deliv-import-zip">
          <Ionicons name="archive-outline" size={16} color="#0A0A0A" />
          <Text style={styles.btnTxt}>Importer un ZIP</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.btnGhost}
          onPress={() => router.push({ pathname: "/admin/wedding-photos/[weddingId]", params: { weddingId: cid } })}
          testID="deliv-gallery"
        >
          <Ionicons name="settings-outline" size={16} color={colors.gold} />
          <Text style={styles.btnGhostTxt}>Galerie</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.label}>Lien de partage Synology (photos volumineuses)</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={photosLink}
          onChangeText={setPhotosLink}
          placeholder="https://gofile.me/… ou quickconnect.to/…"
          placeholderTextColor={colors.textDisabled}
          autoCapitalize="none"
          testID="deliv-photos-link"
        />
        <TouchableOpacity style={styles.saveBtn} onPress={() => saveLinks("photos")} disabled={saving === "photos"} testID="deliv-photos-save">
          {saving === "photos" ? <ActivityIndicator color="#0A0A0A" size="small" /> : <Ionicons name="checkmark" size={20} color="#0A0A0A" />}
        </TouchableOpacity>
      </View>

      {/* ---- 6. Sélection ---- */}
      <Text style={styles.section}>6 · Sélection des 40 photos</Text>
      {sel?.submitted_at ? (
        <View style={styles.received} testID="deliv-selection">
          <Text style={styles.receivedTitle}>✅ {sel.count || 0} photos — reçue le {fmtDateTime(sel.submitted_at)}</Text>
          {sel.filenames?.length ? <Text style={styles.receivedTxt}>{sel.filenames.join(", ")}</Text> : null}
          {sel.filenames_text ? <Text style={styles.receivedTxt}>{sel.filenames_text}</Text> : null}
          {sel.link ? (
            <TouchableOpacity onPress={() => openExternal(sel.link!)}>
              <Text style={styles.link}>🔗 {sel.link}</Text>
            </TouchableOpacity>
          ) : null}
          {sel.note ? <Text style={styles.note}>« {sel.note} »</Text> : null}
          {sel.photo_ids?.length ? (
            <TouchableOpacity style={[styles.btn, { alignSelf: "flex-start", marginTop: 8 }]} onPress={downloadSelection} testID="deliv-selection-download">
              <Ionicons name="download-outline" size={16} color="#0A0A0A" />
              <Text style={styles.btnTxt}>Télécharger la sélection (ZIP)</Text>
            </TouchableOpacity>
          ) : null}
        </View>
      ) : (
        <Text style={styles.muted}>En attente : les mariés cochent leurs photos dans la galerie (ou saisissent la liste des noms si lien Synology).</Text>
      )}

      {/* ---- 7. Musique ---- */}
      <Text style={styles.section}>7 · Musique de mariage</Text>
      {music?.submitted_at ? (
        <View style={styles.received} testID="deliv-music">
          <Text style={styles.receivedTitle}>🎵 {music.title || "Sans titre"}{music.artist ? ` — ${music.artist}` : ""} · reçue le {fmtDateTime(music.submitted_at)}</Text>
          {music.link ? (
            <TouchableOpacity onPress={() => openExternal(music.link!)}>
              <Text style={styles.link}>🔗 {music.link}</Text>
            </TouchableOpacity>
          ) : null}
          {music.file_url ? (
            <TouchableOpacity onPress={() => openExternal(`${BACKEND_URL}${music.file_url}`)}>
              <Text style={styles.link}>🎧 {music.file_original_name || "Fichier audio"} (écouter / télécharger)</Text>
            </TouchableOpacity>
          ) : null}
          {music.note ? <Text style={styles.note}>« {music.note} »</Text> : null}
        </View>
      ) : (
        <Text style={styles.muted}>En attente de la musique des mariés.</Text>
      )}

      {/* ---- 9. Livraison ---- */}
      <Text style={styles.section}>9 · Livraison (lien de téléchargement du film)</Text>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.input}
          value={deliveryLink}
          onChangeText={setDeliveryLink}
          placeholder="Lien Synology du film final (> 40 Go)"
          placeholderTextColor={colors.textDisabled}
          autoCapitalize="none"
          testID="deliv-delivery-link"
        />
        <TouchableOpacity style={styles.saveBtn} onPress={() => saveLinks("delivery")} disabled={saving === "delivery"} testID="deliv-delivery-save">
          {saving === "delivery" ? <ActivityIndicator color="#0A0A0A" size="small" /> : <Ionicons name="checkmark" size={20} color="#0A0A0A" />}
        </TouchableOpacity>
      </View>

      {/* ---- Modal ZIP ---- */}
      <Modal visible={zipModal} transparent animationType="fade" onRequestClose={() => setZipModal(false)}>
        <View style={styles.backdrop}>
          <View style={styles.modal}>
            <Text style={styles.modalTitle}>Importer les photos (ZIP)</Text>
            <Text style={styles.muted}>
              Déposez « {project.wedding_name} photos.zip » dans le dossier FTP : il est importé automatiquement. Sinon choisissez un ZIP déjà déposé ci-dessous.
            </Text>
            <ScrollView style={{ maxHeight: 260, marginTop: spacing.sm }}>
              {zips === null ? (
                <ActivityIndicator color={colors.gold} style={{ margin: spacing.md }} />
              ) : zips.length === 0 ? (
                <Text style={[styles.muted, { textAlign: "center", padding: spacing.md }]}>Aucun fichier .zip dans le dossier FTP</Text>
              ) : (
                zips.map((z) => (
                  <TouchableOpacity key={z.name} style={styles.zipRow} onPress={() => importZip(z.name)} testID={`zip-${z.name}`}>
                    <Ionicons name="archive" size={20} color={colors.gold} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.zipName} numberOfLines={1}>{z.name}</Text>
                      <Text style={styles.muted}>{human(z.size)} · {fmtDateTime(z.modified)}</Text>
                    </View>
                    <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
                  </TouchableOpacity>
                ))
              )}
            </ScrollView>
            <TouchableOpacity style={[styles.btnGhost, { marginTop: spacing.sm, justifyContent: "center" }]} onPress={uploadZip} disabled={uploading} testID="zip-upload">
              {uploading ? <ActivityIndicator color={colors.gold} size="small" /> : <Ionicons name="cloud-upload-outline" size={16} color={colors.gold} />}
              <Text style={styles.btnGhostTxt}>Envoyer un petit ZIP depuis cet appareil</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.cancel} onPress={() => setZipModal(false)} testID="zip-cancel">
              <Text style={{ color: colors.textSecondary }}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    padding: spacing.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: "rgba(212,175,55,0.25)",
    borderRadius: radii.md, marginBottom: spacing.md,
  },
  boxTitle: { color: colors.gold, fontSize: 14, fontWeight: "800", letterSpacing: 0.3 },
  section: { color: colors.ivory, fontSize: 12, fontWeight: "700", marginTop: spacing.md, marginBottom: 6, textTransform: "uppercase", letterSpacing: 0.5 },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  statusTxt: { color: colors.textSecondary, fontSize: 12, flex: 1 },
  btnRow: { flexDirection: "row", gap: spacing.sm, marginBottom: 6 },
  btn: {
    flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: spacing.md,
    borderRadius: radii.sm, backgroundColor: colors.gold,
  },
  btnTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 12 },
  btnGhost: {
    flexDirection: "row", alignItems: "center", gap: 6, minHeight: 44, paddingHorizontal: spacing.md,
    borderRadius: radii.sm, borderWidth: 1, borderColor: "rgba(212,175,55,0.45)",
  },
  btnGhostTxt: { color: colors.gold, fontWeight: "700", fontSize: 12 },
  label: { color: colors.textSecondary, fontSize: 11, marginTop: 6, marginBottom: 4 },
  inputRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: {
    flex: 1, backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
    paddingHorizontal: 12, minHeight: 44, color: colors.ivory, fontSize: 13,
  },
  saveBtn: { width: 44, height: 44, borderRadius: radii.sm, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  received: {
    padding: spacing.sm, borderRadius: radii.sm, backgroundColor: "rgba(46,125,50,0.10)", borderWidth: 1, borderColor: "#2E7D32", gap: 4,
  },
  receivedTitle: { color: "#86EFAC", fontSize: 12, fontWeight: "700" },
  receivedTxt: { color: colors.ivory, fontSize: 12, lineHeight: 17 },
  link: { color: colors.gold, fontSize: 12, textDecorationLine: "underline" },
  note: { color: colors.textSecondary, fontSize: 12, fontStyle: "italic" },
  muted: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "center" },
  modal: { margin: spacing.md, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, borderWidth: 1, borderColor: colors.border },
  modalTitle: { color: colors.ivory, fontSize: 17, fontWeight: "800", marginBottom: 6 },
  zipRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: colors.border, minHeight: 48 },
  zipName: { color: colors.ivory, fontSize: 13, fontWeight: "600" },
  cancel: { marginTop: spacing.sm, alignItems: "center", padding: 10, minHeight: 44, justifyContent: "center" },
});

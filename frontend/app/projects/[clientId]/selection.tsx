/**
 * Étape 6 — Les mariés nous envoient directement leurs photos choisies (cas photos sur le serveur du studio).
 * Jusqu'à SELECTION_UPLOAD_MAX photos, envoi une par une avec progression, puis validation.
 */
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator, Platform, Linking,
} from "react-native";
import { Image } from "expo-image";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { api } from "@/src/api/client";
import { BACKEND_URL } from "@/src/api/baseUrl";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert, confirmAction } from "@/src/utils/dialog";
import {
  type Deliverables, type SelectionUpload, SELECTION_MAX, SELECTION_UPLOAD_MAX, fmtDateTime, linksOf, openExternal, uploadFile,
} from "@/src/features/project-tracking/deliverables";

export default function SelectionScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [deliverables, setDeliverables] = useState<Deliverables>({});
  const [weddingName, setWeddingName] = useState("");
  const [uploads, setUploads] = useState<SelectionUpload[]>([]);
  const [note, setNote] = useState("");
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ deliverables: Deliverables; wedding_name: string }>(`/projects/${clientId}/deliverables`);
      setDeliverables(d.deliverables || {});
      setWeddingName(d.wedding_name || "");
      setUploads(d.deliverables?.selection?.uploads || []);
      setNote(d.deliverables?.selection?.note || "");
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const remaining = SELECTION_UPLOAD_MAX - uploads.length;

  const ensurePermission = async (): Promise<boolean> => {
    if (Platform.OS === "web") return true;
    const cur = await ImagePicker.getMediaLibraryPermissionsAsync();
    if (cur.granted) return true;
    if (cur.canAskAgain) {
      const r = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (r.granted) return true;
    }
    confirmAction(
      "Accès aux photos",
      "Autorisez l'accès à vos photos dans les réglages pour pouvoir nous envoyer votre sélection.",
      () => Linking.openSettings(),
      { confirmText: "Ouvrir les réglages" }
    );
    return false;
  };

  const pickAndUpload = async () => {
    if (remaining <= 0) {
      showAlert("Maximum atteint", `Vous pouvez envoyer ${SELECTION_UPLOAD_MAX} photos maximum. Supprimez-en une pour en ajouter.`);
      return;
    }
    if (!(await ensurePermission())) return;
    const res = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      allowsMultipleSelection: true,
      selectionLimit: remaining,
      quality: 1,
    });
    if (res.canceled || !res.assets?.length) return;
    const assets = res.assets.slice(0, remaining);
    setProgress({ done: 0, total: assets.length });
    let ok = 0;
    const errors: string[] = [];
    for (let i = 0; i < assets.length; i++) {
      const a = assets[i];
      const name = a.fileName || `photo_${Date.now()}_${i}.jpg`;
      try {
        let file: File | Blob = (a as any).file;
        if (!file) file = await fetch(a.uri).then((r) => r.blob());
        const r = await uploadFile(`/projects/${clientId}/selection/upload`, file, name);
        setUploads((prev) => [...prev, r.upload]);
        ok++;
      } catch (e: any) {
        errors.push(`${name} : ${e?.message || "échec"}`);
      }
      setProgress({ done: i + 1, total: assets.length });
    }
    setProgress(null);
    if (errors.length) showAlert("Envoi partiel", `${ok} photo(s) envoyée(s).\n\n${errors.slice(0, 5).join("\n")}`);
  };

  const removeUpload = (u: SelectionUpload) => {
    confirmAction("Retirer cette photo ?", u.original_name || u.filename, async () => {
      try {
        await api(`/projects/${clientId}/selection/upload/${u.id}`, { method: "DELETE" });
        setUploads((prev) => prev.filter((x) => x.id !== u.id));
      } catch (e: any) {
        showAlert("Erreur", e?.message || "Suppression impossible");
      }
    }, { confirmText: "Retirer", destructive: true });
  };

  const submit = async () => {
    if (uploads.length === 0) {
      showAlert("Aucune photo", "Ajoutez d'abord vos photos choisies avec le bouton « Ajouter des photos ».");
      return;
    }
    setSaving(true);
    try {
      await api(`/projects/${clientId}/selection`, { method: "POST", body: { photo_ids: [], note: note.trim() || null } });
      showAlert("✅ Sélection envoyée", `Vos ${uploads.length} photos ont été transmises au studio. Vous pouvez encore la modifier depuis votre suivi.`, () =>
        router.canGoBack() ? router.back() : router.replace("/(tabs)/profile")
      );
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Envoi impossible");
    } finally {
      setSaving(false);
    }
  };

  const photoLinks = linksOf(deliverables.photos, "Mes photos");
  const prev = deliverables.selection;
  const overTarget = uploads.length > SELECTION_MAX;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/profile"))} style={styles.headerBtn} testID="selection-back">
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Mes {SELECTION_MAX} photos choisies</Text>
        <View style={styles.headerBtn} />
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.gold} /></View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl * 2 }} keyboardShouldPersistTaps="handled">
          {weddingName ? <Text style={styles.wedding}>{weddingName}</Text> : null}
          <Text style={styles.intro}>
            1. Téléchargez vos photos depuis le lien du studio. 2. Choisissez vos {SELECTION_MAX} préférées pour le montage. 3. Envoyez-les nous ici.
          </Text>

          {photoLinks.map((l, i) => (
            <TouchableOpacity key={i} style={styles.linkBtn} onPress={() => openExternal(l.url)} testID={`selection-open-photos-${i}`}>
              <Ionicons name="cloud-download-outline" size={18} color={colors.gold} />
              <Text style={styles.linkBtnTxt}>{photoLinks.length > 1 ? l.label : "Ouvrir / télécharger mes photos"}</Text>
              <Ionicons name="open-outline" size={16} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}

          {prev?.submitted_at ? (
            <View style={styles.prevBox}>
              <Ionicons name="checkmark-circle" size={16} color="#4ADE80" />
              <Text style={styles.prevTxt}>Dernière sélection envoyée le {fmtDateTime(prev.submitted_at)} ({prev.count || 0} photos)</Text>
            </View>
          ) : null}

          <View style={styles.counterRow}>
            <Text style={styles.counter} testID="selection-counter">
              {uploads.length} / {SELECTION_MAX} photos
            </Text>
            <Text style={styles.counterSub}>{overTarget ? `Tolérance jusqu'à ${SELECTION_UPLOAD_MAX}` : `(jusqu'à ${SELECTION_UPLOAD_MAX} acceptées)`}</Text>
          </View>

          <View style={styles.grid}>
            {uploads.map((u) => (
              <View key={u.id} style={styles.cell} testID={`selection-upload-${u.id}`}>
                <Image source={{ uri: `${BACKEND_URL}${u.thumb_url}` }} style={styles.thumb} contentFit="cover" transition={150} />
                <TouchableOpacity style={styles.remove} onPress={() => removeUpload(u)} testID={`selection-remove-${u.id}`}>
                  <Ionicons name="close" size={14} color="#fff" />
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={[styles.cell, styles.addCell]} onPress={pickAndUpload} disabled={!!progress} testID="selection-add">
              {progress ? (
                <>
                  <ActivityIndicator color={colors.gold} />
                  <Text style={styles.addTxt}>{progress.done} / {progress.total}</Text>
                </>
              ) : (
                <>
                  <Ionicons name="add" size={28} color={colors.gold} />
                  <Text style={styles.addTxt}>Ajouter des photos</Text>
                </>
              )}
            </TouchableOpacity>
          </View>

          <Text style={styles.label}>Message pour le studio (facultatif)</Text>
          <TextInput
            style={styles.input}
            value={note}
            onChangeText={setNote}
            placeholder="Ex. la photo du bouquet en ouverture du film…"
            placeholderTextColor={colors.textDisabled}
            multiline
            textAlignVertical="top"
            testID="selection-note"
          />

          <TouchableOpacity style={[styles.submit, (saving || !!progress) && { opacity: 0.6 }]} onPress={submit} disabled={saving || !!progress} testID="selection-submit">
            {saving ? <ActivityIndicator color="#0A0A0A" /> : (
              <>
                <Ionicons name="send" size={18} color="#0A0A0A" />
                <Text style={styles.submitTxt}>Valider ma sélection ({uploads.length})</Text>
              </>
            )}
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const CELL = 104;
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  headerTitle: { flex: 1, color: colors.gold, fontSize: 15, fontWeight: "800", textAlign: "center", letterSpacing: 0.5 },
  wedding: { color: colors.ivory, fontSize: 18, fontWeight: "700", marginBottom: 6 },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginBottom: spacing.md },
  linkBtn: {
    flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: spacing.md,
    borderRadius: radii.md, borderWidth: 1, borderColor: "rgba(212,175,55,0.45)", backgroundColor: "rgba(212,175,55,0.08)",
    marginBottom: spacing.sm,
  },
  linkBtnTxt: { flex: 1, color: colors.gold, fontWeight: "700", fontSize: 14 },
  prevBox: {
    flexDirection: "row", alignItems: "center", gap: 8, padding: spacing.sm, borderRadius: radii.sm,
    backgroundColor: "rgba(46,125,50,0.10)", borderWidth: 1, borderColor: "#2E7D32", marginTop: spacing.sm,
  },
  prevTxt: { color: "#9AE6B4", fontSize: 12, flex: 1 },
  counterRow: { flexDirection: "row", alignItems: "baseline", gap: 8, marginTop: spacing.md, marginBottom: spacing.sm },
  counter: { color: colors.gold, fontSize: 18, fontWeight: "800" },
  counterSub: { color: colors.textSecondary, fontSize: 11 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  cell: { width: CELL, height: CELL, borderRadius: radii.sm, overflow: "hidden", backgroundColor: colors.surface },
  thumb: { width: "100%", height: "100%" },
  remove: {
    position: "absolute", top: 4, right: 4, width: 26, height: 26, borderRadius: 13,
    backgroundColor: "rgba(0,0,0,0.65)", alignItems: "center", justifyContent: "center",
  },
  addCell: { alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: "rgba(212,175,55,0.45)", backgroundColor: "rgba(212,175,55,0.06)", gap: 4 },
  addTxt: { color: colors.gold, fontSize: 11, fontWeight: "700", textAlign: "center", paddingHorizontal: 6 },
  label: { color: colors.ivory, fontSize: 12, fontWeight: "700", marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
    padding: 12, color: colors.ivory, fontSize: 14, minHeight: 70,
  },
  submit: {
    marginTop: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    minHeight: 50, borderRadius: radii.sm, backgroundColor: colors.gold,
  },
  submitTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 15 },
});

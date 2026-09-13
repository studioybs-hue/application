/**
 * Étape 6 — Sélection des 40 photos (mode lien Synology : liste des noms de fichiers).
 */
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert } from "@/src/utils/dialog";
import {
  type Deliverables, SELECTION_MAX, fmtDateTime, openExternal,
} from "@/src/features/project-tracking/deliverables";

export default function SelectionScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [deliverables, setDeliverables] = useState<Deliverables>({});
  const [weddingName, setWeddingName] = useState("");
  const [text, setText] = useState("");
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ deliverables: Deliverables; wedding_name: string }>(`/projects/${clientId}/deliverables`);
      setDeliverables(d.deliverables || {});
      setWeddingName(d.wedding_name || "");
      const sel = d.deliverables?.selection;
      if (sel) {
        setText(sel.filenames_text || "");
        setLink(sel.link || "");
        setNote(sel.note || "");
      }
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const count = text.split(/[,\n;]+/).map((t) => t.trim()).filter(Boolean).length;

  const submit = async () => {
    if (!text.trim() && !link.trim()) {
      showAlert("Sélection vide", "Indiquez les noms des photos choisies ou un lien vers votre dossier.");
      return;
    }
    if (count > SELECTION_MAX) {
      showAlert("Trop de photos", `${count} noms saisis : la sélection est limitée à ${SELECTION_MAX} photos.`);
      return;
    }
    setSaving(true);
    try {
      await api(`/projects/${clientId}/selection`, {
        method: "POST",
        body: { filenames_text: text.trim() || null, link: link.trim() || null, note: note.trim() || null },
      });
      showAlert("✅ Sélection envoyée", "Le studio a bien reçu votre sélection. Vous pouvez la modifier à tout moment.", () =>
        router.canGoBack() ? router.back() : router.replace("/(tabs)/profile")
      );
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Envoi impossible");
    } finally {
      setSaving(false);
    }
  };

  const photosLink = deliverables.photos?.link;
  const prev = deliverables.selection;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/profile"))} style={styles.headerBtn} testID="selection-back">
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>Sélection des {SELECTION_MAX} photos</Text>
        <View style={styles.headerBtn} />
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.gold} /></View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl * 2 }} keyboardShouldPersistTaps="handled">
            {weddingName ? <Text style={styles.wedding}>{weddingName}</Text> : null}
            <Text style={styles.intro}>
              Parcourez vos photos, puis indiquez-nous ci-dessous les noms des {SELECTION_MAX} photos que vous souhaitez voir dans le montage.
            </Text>

            {photosLink ? (
              <TouchableOpacity style={styles.linkBtn} onPress={() => openExternal(photosLink)} testID="selection-open-photos">
                <Ionicons name="cloud-download-outline" size={18} color={colors.gold} />
                <Text style={styles.linkBtnTxt}>Ouvrir / télécharger mes photos</Text>
                <Ionicons name="open-outline" size={16} color={colors.textSecondary} />
              </TouchableOpacity>
            ) : null}

            {prev?.submitted_at ? (
              <View style={styles.prevBox}>
                <Ionicons name="checkmark-circle" size={16} color="#4ADE80" />
                <Text style={styles.prevTxt}>Dernière sélection envoyée le {fmtDateTime(prev.submitted_at)} ({prev.count || 0} photos)</Text>
              </View>
            ) : null}

            <Text style={styles.label}>Noms des photos choisies <Text style={styles.counter}>({count} / {SELECTION_MAX})</Text></Text>
            <TextInput
              style={[styles.input, styles.textarea]}
              value={text}
              onChangeText={setText}
              placeholder={"Un nom par ligne ou séparés par des virgules\nex. IMG_0123, IMG_0456, DSC_7890"}
              placeholderTextColor={colors.textDisabled}
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              testID="selection-text"
            />

            <Text style={styles.label}>Lien vers votre dossier (facultatif)</Text>
            <TextInput
              style={styles.input}
              value={link}
              onChangeText={setLink}
              placeholder="https://… (Drive, WeTransfer, Synology…)"
              placeholderTextColor={colors.textDisabled}
              autoCapitalize="none"
              keyboardType="url"
              testID="selection-link"
            />

            <Text style={styles.label}>Message pour le studio (facultatif)</Text>
            <TextInput
              style={[styles.input, { minHeight: 70 }]}
              value={note}
              onChangeText={setNote}
              placeholder="Ex. la photo IMG_0123 en ouverture du film…"
              placeholderTextColor={colors.textDisabled}
              multiline
              textAlignVertical="top"
              testID="selection-note"
            />

            <TouchableOpacity style={[styles.submit, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving} testID="selection-submit">
              {saving ? <ActivityIndicator color="#0A0A0A" /> : (
                <>
                  <Ionicons name="send" size={18} color="#0A0A0A" />
                  <Text style={styles.submitTxt}>Envoyer ma sélection</Text>
                </>
              )}
            </TouchableOpacity>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

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
    marginBottom: spacing.md,
  },
  linkBtnTxt: { flex: 1, color: colors.gold, fontWeight: "700", fontSize: 14 },
  prevBox: {
    flexDirection: "row", alignItems: "center", gap: 8, padding: spacing.sm, borderRadius: radii.sm,
    backgroundColor: "rgba(46,125,50,0.10)", borderWidth: 1, borderColor: "#2E7D32", marginBottom: spacing.md,
  },
  prevTxt: { color: "#9AE6B4", fontSize: 12, flex: 1 },
  label: { color: colors.ivory, fontSize: 12, fontWeight: "700", marginTop: spacing.sm, marginBottom: 6 },
  counter: { color: colors.gold, fontWeight: "800" },
  input: {
    backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
    padding: 12, color: colors.ivory, fontSize: 14,
  },
  textarea: { minHeight: 160 },
  submit: {
    marginTop: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    minHeight: 50, borderRadius: radii.sm, backgroundColor: colors.gold,
  },
  submitTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 15 },
});

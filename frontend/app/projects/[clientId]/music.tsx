/**
 * Étape 7 — Musique de mariage : titre / artiste / lien et/ou fichier audio.
 */
import { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert } from "@/src/utils/dialog";
import { type MusicDeliverable, fmtDateTime, uploadFile } from "@/src/features/project-tracking/deliverables";

export default function MusicScreen() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [music, setMusic] = useState<MusicDeliverable>({});
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");
  const [link, setLink] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<{ deliverables: { music?: MusicDeliverable } }>(`/projects/${clientId}/deliverables`);
      const m = d.deliverables?.music || {};
      setMusic(m);
      setTitle(m.title || "");
      setArtist(m.artist || "");
      setLink(m.link || "");
      setNote(m.note || "");
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Chargement impossible");
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const submit = async () => {
    if (!title.trim() && !link.trim() && !music.file_url) {
      showAlert("Musique manquante", "Indiquez au moins le titre de la musique, un lien d'écoute ou envoyez le fichier audio.");
      return;
    }
    setSaving(true);
    try {
      await api(`/projects/${clientId}/music`, {
        method: "POST",
        body: { title: title.trim() || null, artist: artist.trim() || null, link: link.trim() || null, note: note.trim() || null },
      });
      showAlert("✅ Musique envoyée", "Le studio a bien reçu votre musique pour le montage.", () =>
        router.canGoBack() ? router.back() : router.replace("/(tabs)/profile")
      );
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Envoi impossible");
    } finally {
      setSaving(false);
    }
  };

  const pickAudio = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: ["audio/*"], multiple: false, copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      setUploading(true);
      let fileObj: File | Blob = (asset as any).file;
      if (!fileObj) {
        fileObj = await fetch(asset.uri).then((r) => r.blob());
      }
      const r = await uploadFile(`/projects/${clientId}/music/file`, fileObj, asset.name || "musique.mp3");
      setMusic((m) => ({ ...m, file_url: r.file_url, file_original_name: asset.name, submitted_at: new Date().toISOString() }));
      showAlert("✅ Fichier reçu", `${asset.name} a été transmis au studio.`);
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Envoi du fichier impossible");
    } finally {
      setUploading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/profile"))} style={styles.headerBtn} testID="music-back">
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Musique de mariage</Text>
        <View style={styles.headerBtn} />
      </View>
      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.gold} /></View>
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl * 2 }} keyboardShouldPersistTaps="handled">
            <View style={styles.hero}>
              <Ionicons name="musical-notes" size={40} color={colors.gold} />
              <Text style={styles.intro}>
                Quelle musique doit accompagner votre film ? Indiquez le titre et l&apos;artiste, un lien d&apos;écoute (YouTube, Spotify, Deezer…) et/ou envoyez-nous le fichier audio.
              </Text>
            </View>

            {music.submitted_at ? (
              <View style={styles.prevBox}>
                <Ionicons name="checkmark-circle" size={16} color="#4ADE80" />
                <Text style={styles.prevTxt}>
                  Reçue le {fmtDateTime(music.submitted_at)}{music.file_original_name ? ` · fichier : ${music.file_original_name}` : ""}
                </Text>
              </View>
            ) : null}

            <Text style={styles.label}>Titre</Text>
            <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="Ex. Perfect" placeholderTextColor={colors.textDisabled} testID="music-title" />

            <Text style={styles.label}>Artiste</Text>
            <TextInput style={styles.input} value={artist} onChangeText={setArtist} placeholder="Ex. Ed Sheeran" placeholderTextColor={colors.textDisabled} testID="music-artist" />

            <Text style={styles.label}>Lien d&apos;écoute (facultatif)</Text>
            <TextInput
              style={styles.input} value={link} onChangeText={setLink}
              placeholder="https://youtu.be/… ou open.spotify.com/…" placeholderTextColor={colors.textDisabled}
              autoCapitalize="none" keyboardType="url" testID="music-link"
            />

            <Text style={styles.label}>Fichier audio (facultatif, 40 Mo max)</Text>
            <TouchableOpacity style={styles.fileBtn} onPress={pickAudio} disabled={uploading} testID="music-file">
              {uploading ? <ActivityIndicator color={colors.gold} /> : <Ionicons name="cloud-upload-outline" size={20} color={colors.gold} />}
              <Text style={styles.fileTxt}>
                {music.file_original_name ? `Remplacer : ${music.file_original_name}` : "Choisir un fichier MP3 / M4A / WAV"}
              </Text>
            </TouchableOpacity>

            <Text style={styles.label}>Précisions (facultatif)</Text>
            <TextInput
              style={[styles.input, { minHeight: 80 }]} value={note} onChangeText={setNote}
              placeholder="Ex. démarrer au refrain, version acoustique…" placeholderTextColor={colors.textDisabled}
              multiline textAlignVertical="top" testID="music-note"
            />

            <TouchableOpacity style={[styles.submit, saving && { opacity: 0.6 }]} onPress={submit} disabled={saving} testID="music-submit">
              {saving ? <ActivityIndicator color="#0A0A0A" /> : (
                <>
                  <Ionicons name="send" size={18} color="#0A0A0A" />
                  <Text style={styles.submitTxt}>Envoyer ma musique</Text>
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
  hero: { alignItems: "center", gap: spacing.sm, marginBottom: spacing.md },
  intro: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, textAlign: "center" },
  prevBox: {
    flexDirection: "row", alignItems: "center", gap: 8, padding: spacing.sm, borderRadius: radii.sm,
    backgroundColor: "rgba(46,125,50,0.10)", borderWidth: 1, borderColor: "#2E7D32", marginBottom: spacing.sm,
  },
  prevTxt: { color: "#9AE6B4", fontSize: 12, flex: 1 },
  label: { color: colors.ivory, fontSize: 12, fontWeight: "700", marginTop: spacing.sm, marginBottom: 6 },
  input: {
    backgroundColor: "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: colors.border, borderRadius: radii.sm,
    padding: 12, color: colors.ivory, fontSize: 14,
  },
  fileBtn: {
    flexDirection: "row", alignItems: "center", gap: 10, minHeight: 48, paddingHorizontal: spacing.md,
    borderRadius: radii.sm, borderWidth: 1, borderColor: "rgba(212,175,55,0.45)", backgroundColor: "rgba(212,175,55,0.08)",
  },
  fileTxt: { color: colors.gold, fontWeight: "700", fontSize: 13, flex: 1 },
  submit: {
    marginTop: spacing.lg, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    minHeight: 50, borderRadius: radii.sm, backgroundColor: colors.gold,
  },
  submitTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 15 },
});

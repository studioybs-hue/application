import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Switch,
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { api } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { colors, spacing, radii } from "@/src/theme";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const CATEGORIES = ["À l'affiche", "Cérémonies", "Soirées", "Best Of"];

type Form = {
  title: string;
  description: string;
  category: string;
  poster_url: string;
  hero_url: string;
  trailer_url: string;
  full_url: string;
  duration_minutes: string;
  is_featured: boolean;
  is_top_france: boolean;
  client_name: string;
};

const EMPTY: Form = {
  title: "",
  description: "",
  category: "À l'affiche",
  poster_url: "",
  hero_url: "",
  trailer_url: "",
  full_url: "",
  duration_minutes: "0",
  is_featured: false,
  is_top_france: false,
  client_name: "",
};

export default function VideoEdit() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"poster" | "trailer" | "full" | null>(null);
  const [progress, setProgress] = useState<{ poster?: number; trailer?: number; full?: number }>({});
  const [uploadedStatus, setUploadedStatus] = useState<{ poster?: boolean; trailer?: boolean; full?: boolean }>({});

  useEffect(() => {
    if (isNew) return;
    (async () => {
      try {
        const r = await api<{ videos: any[] }>("/admin/videos");
        const v = r.videos.find((x) => x.id === id);
        if (v) {
          setForm({
            title: v.title || "",
            description: v.description || "",
            category: v.category || "À l'affiche",
            poster_url: v.poster_url || "",
            hero_url: v.hero_url || "",
            trailer_url: v.trailer_url || "",
            full_url: v.full_url || "",
            duration_minutes: String(v.duration_minutes || 0),
            is_featured: !!v.is_featured,
            is_top_france: !!v.is_top_france,
          });
        }
      } catch (e: any) {
        Alert.alert("Erreur", e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isNew]);

  const set = (k: keyof Form, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const upload = async (target: "poster" | "trailer" | "full") => {
    try {
      let asset: { uri: string; name?: string; mimeType?: string; size?: number } | null = null;
      if (target === "poster") {
        const r = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.9,
        });
        if (r.canceled || !r.assets?.[0]) return;
        asset = { uri: r.assets[0].uri, name: r.assets[0].fileName || "poster.jpg", mimeType: r.assets[0].mimeType, size: r.assets[0].fileSize };
      } else {
        const r = await DocumentPicker.getDocumentAsync({ type: "video/*", copyToCacheDirectory: true });
        if (r.canceled || !r.assets?.[0]) return;
        asset = { uri: r.assets[0].uri, name: r.assets[0].name, mimeType: r.assets[0].mimeType, size: r.assets[0].size };
      }
      setUploading(target);
      setProgress((p) => ({ ...p, [target]: 0 }));
      setUploadedStatus((s) => ({ ...s, [target]: false }));

      const token = await storage.secureGet<string>("ws_token", "");
      const fd = new FormData();
      fd.append("kind", target === "poster" ? "image" : "video");
      if (Platform.OS === "web") {
        // On web, fetch the URI as a Blob
        const blob = await (await fetch(asset.uri)).blob();
        fd.append("file", blob, asset.name || "file");
      } else {
        // @ts-ignore - RN FormData accepts {uri,name,type}
        fd.append("file", { uri: asset.uri, name: asset.name || "file", type: asset.mimeType || "application/octet-stream" });
      }

      // Use XMLHttpRequest for real upload progress
      const url = `${BASE}/api/admin/upload`;
      const result = await new Promise<{ url: string }>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", url);
        xhr.setRequestHeader("Authorization", `Bearer ${token}`);
        xhr.upload.onprogress = (e: any) => {
          if (e.lengthComputable) {
            const pct = Math.round((e.loaded / e.total) * 100);
            setProgress((p) => ({ ...p, [target]: pct }));
          }
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              resolve(JSON.parse(xhr.responseText));
            } catch (e) {
              reject(new Error("Réponse invalide du serveur"));
            }
          } else {
            try {
              const err = JSON.parse(xhr.responseText);
              reject(new Error(err.detail || `HTTP ${xhr.status}`));
            } catch {
              reject(new Error(`Erreur ${xhr.status}`));
            }
          }
        };
        xhr.onerror = () => reject(new Error("Erreur réseau pendant l'upload"));
        xhr.ontimeout = () => reject(new Error("Timeout de l'upload"));
        xhr.send(fd as any);
      });

      if (target === "poster") set("poster_url", result.url);
      else if (target === "trailer") set("trailer_url", result.url);
      else set("full_url", result.url);

      setProgress((p) => ({ ...p, [target]: 100 }));
      setUploadedStatus((s) => ({ ...s, [target]: true }));
    } catch (e: any) {
      Alert.alert("Erreur d'upload", e.message || "Téléversement échoué. Vérifiez votre connexion ou essayez un fichier plus petit.");
      setProgress((p) => ({ ...p, [target]: undefined }));
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    if (!form.title.trim()) {
      Alert.alert("Erreur", "Le titre est requis");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        duration_minutes: parseInt(form.duration_minutes || "0", 10) || 0,
      };
      if (isNew) {
        await api("/admin/videos", { method: "POST", body: payload });
      } else {
        await api(`/admin/videos/${id}`, { method: "PATCH", body: payload });
      }
      router.back();
    } catch (e: any) {
      Alert.alert("Erreur", e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <View style={styles.loading}><ActivityIndicator color={colors.gold} /></View>;
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} testID="video-edit-back">
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
          <Text style={styles.title}>{isNew ? "Nouvelle vidéo" : "Modifier la vidéo"}</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}>
          <Field label="Titre de la vidéo *">
            <TextInput style={styles.input} value={form.title} onChangeText={(t) => set("title", t)} placeholder="Ex: Cérémonie civile" placeholderTextColor={colors.textDisabled} testID="video-title-input" />
          </Field>

          <Field label="Nom du couple / mariage *">
            <TextInput style={styles.input} value={form.client_name} onChangeText={(t) => set("client_name", t)} placeholder="Ex: Camille & Antoine" placeholderTextColor={colors.textDisabled} testID="video-client-name-input" />
            <Text style={styles.hint}>📌 Toutes les vidéos avec le même nom forment un seul mariage. Le code unique débloque tout le mariage.</Text>
          </Field>

          <Field label="Description">
            <TextInput style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]} value={form.description} onChangeText={(t) => set("description", t)} placeholder="Une cérémonie inoubliable…" placeholderTextColor={colors.textDisabled} multiline />
          </Field>

          <Field label="Catégorie">
            <View style={styles.chips}>
              {CATEGORIES.map((c) => (
                <TouchableOpacity
                  key={c}
                  style={[styles.chip, form.category === c && styles.chipActive]}
                  onPress={() => set("category", c)}
                  testID={`cat-${c}`}
                >
                  <Text style={[styles.chipTxt, form.category === c && { color: "#0A0A0A", fontWeight: "700" }]}>{c}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </Field>

          <Field label="Poster (image)">
            {form.poster_url ? <Image source={{ uri: form.poster_url }} style={styles.posterPreview} contentFit="cover" /> : null}
            <TextInput style={styles.input} value={form.poster_url} onChangeText={(t) => set("poster_url", t)} placeholder="URL du poster" placeholderTextColor={colors.textDisabled} autoCapitalize="none" />
            <UploadButton
              icon="cloud-upload-outline"
              label="Téléverser une image"
              uploading={uploading === "poster"}
              progress={progress.poster}
              done={uploadedStatus.poster}
              disabled={uploading !== null && uploading !== "poster"}
              onPress={() => upload("poster")}
              testID="upload-poster"
            />
          </Field>

          <Field label="Hero (image grand format)">
            <TextInput style={styles.input} value={form.hero_url} onChangeText={(t) => set("hero_url", t)} placeholder="URL (vide = utilise le poster)" placeholderTextColor={colors.textDisabled} autoCapitalize="none" />
          </Field>

          <Field label="Bande-annonce (publique)">
            <TextInput style={styles.input} value={form.trailer_url} onChangeText={(t) => set("trailer_url", t)} placeholder="URL du trailer .mp4" placeholderTextColor={colors.textDisabled} autoCapitalize="none" />
            <UploadButton
              icon="film-outline"
              label="Téléverser le trailer"
              uploading={uploading === "trailer"}
              progress={progress.trailer}
              done={uploadedStatus.trailer}
              disabled={uploading !== null && uploading !== "trailer"}
              onPress={() => upload("trailer")}
              testID="upload-trailer"
            />
          </Field>

          <Field label="Vidéo complète (privée)">
            <TextInput style={styles.input} value={form.full_url} onChangeText={(t) => set("full_url", t)} placeholder="URL du film complet .mp4" placeholderTextColor={colors.textDisabled} autoCapitalize="none" />
            <UploadButton
              icon="lock-closed-outline"
              label="Téléverser le film"
              uploading={uploading === "full"}
              progress={progress.full}
              done={uploadedStatus.full}
              disabled={uploading !== null && uploading !== "full"}
              onPress={() => upload("full")}
              testID="upload-full"
            />
          </Field>

          <Field label="Durée (minutes)">
            <TextInput style={styles.input} value={form.duration_minutes} onChangeText={(t) => set("duration_minutes", t.replace(/[^0-9]/g, ""))} keyboardType="numeric" placeholder="42" placeholderTextColor={colors.textDisabled} />
          </Field>

          <View style={styles.switchRow}>
            <Text style={styles.label}>À l&apos;affiche</Text>
            <Switch value={form.is_featured} onValueChange={(v) => set("is_featured", v)} trackColor={{ true: colors.gold }} testID="switch-featured" />
          </View>
          <View style={styles.switchRow}>
            <Text style={styles.label}>N°1 en France</Text>
            <Switch value={form.is_top_france} onValueChange={(v) => set("is_top_france", v)} trackColor={{ true: colors.wine }} testID="switch-top" />
          </View>

          <TouchableOpacity style={[styles.saveBtn, uploading && { opacity: 0.5 }]} onPress={save} disabled={saving || uploading !== null} testID="save-video-btn">
            {saving ? <ActivityIndicator color="#0A0A0A" /> : (
              uploading ? <Text style={styles.saveTxt}>Upload en cours…</Text> : <Text style={styles.saveTxt}>{isNew ? "Créer la vidéo" : "Enregistrer"}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function UploadButton({ icon, label, uploading, progress, done, disabled, onPress, testID }: {
  icon: any; label: string; uploading: boolean; progress?: number; done?: boolean; disabled?: boolean; onPress: () => void; testID: string;
}) {
  if (uploading) {
    const pct = Math.max(0, Math.min(100, progress ?? 0));
    return (
      <View style={styles.progressContainer} testID={`${testID}-progress`}>
        <View style={styles.progressHeader}>
          <Ionicons name="cloud-upload" size={16} color={colors.gold} />
          <Text style={styles.progressLabel}>Téléversement en cours… {pct}%</Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${pct}%` }]} />
        </View>
      </View>
    );
  }
  if (done) {
    return (
      <View style={styles.uploadDone} testID={`${testID}-done`}>
        <Ionicons name="checkmark-circle" size={18} color={colors.success} />
        <Text style={styles.uploadDoneTxt}>Fichier téléversé avec succès</Text>
        <TouchableOpacity onPress={onPress} disabled={disabled}>
          <Text style={styles.uploadReplaceTxt}>Remplacer</Text>
        </TouchableOpacity>
      </View>
    );
  }
  return (
    <TouchableOpacity style={[styles.uploadBtn, disabled && { opacity: 0.4 }]} onPress={onPress} disabled={disabled} testID={testID}>
      <Ionicons name={icon} size={16} color={colors.gold} />
      <Text style={styles.uploadTxt}>{label}</Text>
    </TouchableOpacity>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.label}>{label}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.md },
  title: { flex: 1, color: colors.ivory, fontSize: 18, fontWeight: "700", textAlign: "center" },
  label: { color: colors.textSecondary, fontSize: 12, marginBottom: 6, letterSpacing: 0.5, textTransform: "uppercase" },
  hint: { color: colors.gold, fontSize: 11, marginTop: 6, fontStyle: "italic", lineHeight: 16 },
  input: { backgroundColor: colors.surface, color: colors.ivory, borderRadius: radii.sm, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipTxt: { color: colors.ivory, fontSize: 13 },
  posterPreview: { width: 100, height: 150, borderRadius: 6, marginBottom: 8 },
  uploadBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8, paddingVertical: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" },
  uploadTxt: { color: colors.gold, fontWeight: "600", fontSize: 13 },
  progressContainer: { marginTop: 8, padding: 12, borderRadius: radii.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.gold },
  progressHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  progressLabel: { color: colors.ivory, fontSize: 13, fontWeight: "600" },
  progressTrack: { height: 8, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden" },
  progressFill: { height: 8, backgroundColor: colors.gold, borderRadius: 4 },
  uploadDone: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, padding: 12, borderRadius: radii.sm, backgroundColor: "rgba(46,125,50,0.12)", borderWidth: 1, borderColor: "rgba(46,125,50,0.5)" },
  uploadDoneTxt: { color: colors.ivory, fontSize: 13, fontWeight: "600", flex: 1 },
  uploadReplaceTxt: { color: colors.gold, fontSize: 12, fontWeight: "700", textDecorationLine: "underline" },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.sm, marginBottom: spacing.sm },
  saveBtn: { backgroundColor: colors.gold, paddingVertical: 16, borderRadius: radii.sm, alignItems: "center", marginTop: spacing.lg },
  saveTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15, letterSpacing: 0.5 },
});

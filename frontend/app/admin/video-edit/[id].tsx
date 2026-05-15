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
};

export default function VideoEdit() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const isNew = id === "new";
  const [form, setForm] = useState<Form>(EMPTY);
  const [loading, setLoading] = useState(!isNew);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<"poster" | "trailer" | "full" | null>(null);

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
      let asset: { uri: string; name?: string; mimeType?: string } | null = null;
      if (target === "poster") {
        const r = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.9,
        });
        if (r.canceled || !r.assets?.[0]) return;
        asset = { uri: r.assets[0].uri, name: r.assets[0].fileName || "poster.jpg", mimeType: r.assets[0].mimeType };
      } else {
        const r = await DocumentPicker.getDocumentAsync({ type: "video/*", copyToCacheDirectory: true });
        if (r.canceled || !r.assets?.[0]) return;
        asset = { uri: r.assets[0].uri, name: r.assets[0].name, mimeType: r.assets[0].mimeType };
      }
      setUploading(target);
      const token = await storage.secureGet<string>("ws_token", "");
      const fd = new FormData();
      fd.append("kind", target === "poster" ? "image" : "video");
      // RN FormData file
      // @ts-ignore
      fd.append("file", { uri: asset.uri, name: asset.name || "file", type: asset.mimeType || "application/octet-stream" });
      const res = await fetch(`${BASE}/api/admin/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Erreur upload");
      if (target === "poster") set("poster_url", data.url);
      else if (target === "trailer") set("trailer_url", data.url);
      else set("full_url", data.url);
      Alert.alert("✓ Fichier envoyé", "L'URL a été remplie automatiquement.");
    } catch (e: any) {
      Alert.alert("Erreur", e.message);
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
          <Field label="Titre *">
            <TextInput style={styles.input} value={form.title} onChangeText={(t) => set("title", t)} placeholder="Camille & Antoine" placeholderTextColor={colors.textDisabled} testID="video-title-input" />
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
            <TouchableOpacity style={styles.uploadBtn} onPress={() => upload("poster")} disabled={uploading === "poster"} testID="upload-poster">
              {uploading === "poster" ? <ActivityIndicator color={colors.gold} /> : <><Ionicons name="cloud-upload-outline" size={16} color={colors.gold} /><Text style={styles.uploadTxt}>Téléverser une image</Text></>}
            </TouchableOpacity>
          </Field>

          <Field label="Hero (image grand format)">
            <TextInput style={styles.input} value={form.hero_url} onChangeText={(t) => set("hero_url", t)} placeholder="URL (vide = utilise le poster)" placeholderTextColor={colors.textDisabled} autoCapitalize="none" />
          </Field>

          <Field label="Bande-annonce (publique)">
            <TextInput style={styles.input} value={form.trailer_url} onChangeText={(t) => set("trailer_url", t)} placeholder="URL du trailer .mp4" placeholderTextColor={colors.textDisabled} autoCapitalize="none" />
            <TouchableOpacity style={styles.uploadBtn} onPress={() => upload("trailer")} disabled={uploading === "trailer"} testID="upload-trailer">
              {uploading === "trailer" ? <ActivityIndicator color={colors.gold} /> : <><Ionicons name="film-outline" size={16} color={colors.gold} /><Text style={styles.uploadTxt}>Téléverser le trailer</Text></>}
            </TouchableOpacity>
          </Field>

          <Field label="Vidéo complète (privée)">
            <TextInput style={styles.input} value={form.full_url} onChangeText={(t) => set("full_url", t)} placeholder="URL du film complet .mp4" placeholderTextColor={colors.textDisabled} autoCapitalize="none" />
            <TouchableOpacity style={styles.uploadBtn} onPress={() => upload("full")} disabled={uploading === "full"} testID="upload-full">
              {uploading === "full" ? <ActivityIndicator color={colors.gold} /> : <><Ionicons name="lock-closed-outline" size={16} color={colors.gold} /><Text style={styles.uploadTxt}>Téléverser le film</Text></>}
            </TouchableOpacity>
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

          <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving} testID="save-video-btn">
            {saving ? <ActivityIndicator color="#0A0A0A" /> : <Text style={styles.saveTxt}>{isNew ? "Créer la vidéo" : "Enregistrer"}</Text>}
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  input: { backgroundColor: colors.surface, color: colors.ivory, borderRadius: radii.sm, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipTxt: { color: colors.ivory, fontSize: 13 },
  posterPreview: { width: 100, height: 150, borderRadius: 6, marginBottom: 8 },
  uploadBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8, paddingVertical: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" },
  uploadTxt: { color: colors.gold, fontWeight: "600", fontSize: 13 },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.sm, marginBottom: spacing.sm },
  saveBtn: { backgroundColor: colors.gold, paddingVertical: 16, borderRadius: radii.sm, alignItems: "center", marginTop: spacing.lg },
  saveTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15, letterSpacing: 0.5 },
});

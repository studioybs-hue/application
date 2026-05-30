/**
 * Admin Wedding Cover — set/override the wedding-level poster + hero (separate from videos).
 *
 * This lets the studio choose a dedicated cover photo for the wedding card on the homepage,
 * independent of any individual video poster.
 */
import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { api } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { showAlert } from "@/src/utils/dialog";
import { colors, spacing, radii } from "@/src/theme";
import { FtpPicker } from "@/src/ui/FtpPicker";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

type Cover = {
  client_id: string;
  poster_url: string;
  hero_url: string;
  description: string;
};

export default function AdminWeddingCover() {
  const router = useRouter();
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const cid = String(clientId || "");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [posterUrl, setPosterUrl] = useState("");
  const [heroUrl, setHeroUrl] = useState("");
  const [description, setDescription] = useState("");
  const [progress, setProgress] = useState<{ [k: string]: number }>({});
  const [ftpTarget, setFtpTarget] = useState<"poster" | "hero" | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<Cover>(`/admin/weddings/${cid}/cover`);
        setPosterUrl(r.poster_url || "");
        setHeroUrl(r.hero_url || "");
        setDescription(r.description || "");
      } catch (e: any) {
        showAlert("Erreur", e.message || "Impossible de charger la couverture");
      } finally {
        setLoading(false);
      }
    })();
  }, [cid]);

  const pickAndUpload = async (target: "poster" | "hero") => {
    try {
      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.95,
        allowsMultipleSelection: false,
      });
      if (res.canceled || !res.assets?.[0]) return;
      const asset = res.assets[0];
      setProgress((p) => ({ ...p, [target]: 1 }));

      const blob = Platform.OS === "web"
        ? await fetch(asset.uri).then((r) => r.blob())
        : (() => {
            // @ts-ignore - RN file blob shape for FormData
            return { uri: asset.uri, type: asset.mimeType || "image/jpeg", name: asset.fileName || `${target}.jpg` };
          })();

      const token = await storage.secureGet<string>("ws_token", "");
      const fd = new FormData();
      fd.append("kind", "image");
      // @ts-ignore — RN/web FormData
      fd.append("file", blob, asset.fileName || `${target}.jpg`);

      const finalUrl = await new Promise<string>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", `${BASE}/api/admin/upload`);
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
              const j = JSON.parse(xhr.responseText);
              resolve(j.url);
            } catch {
              reject(new Error("Réponse invalide du serveur"));
            }
          } else {
            reject(new Error(`Erreur ${xhr.status}`));
          }
        };
        xhr.onerror = () => reject(new Error("Erreur réseau"));
        xhr.send(fd as any);
      });

      if (target === "poster") setPosterUrl(finalUrl);
      else setHeroUrl(finalUrl);
      setProgress((p) => ({ ...p, [target]: 100 }));
      setTimeout(() => setProgress((p) => { const c = { ...p }; delete c[target]; return c; }), 800);
    } catch (e: any) {
      showAlert("Upload échoué", e.message || "Impossible d'uploader l'image");
      setProgress((p) => { const c = { ...p }; delete c[target]; return c; });
    }
  };

  const save = async () => {
    setSaving(true);
    try {
      await api(`/admin/weddings/${cid}/cover`, {
        method: "PUT",
        body: {
          poster_url: posterUrl.trim(),
          hero_url: heroUrl.trim(),
          description: description.trim(),
        },
      });
      showAlert("✅ Enregistré", "La couverture du mariage a été mise à jour.");
      router.back();
    } catch (e: any) {
      showAlert("Erreur", e.message || "Sauvegarde impossible");
    } finally {
      setSaving(false);
    }
  };

  const clearAll = async () => {
    setSaving(true);
    try {
      await api(`/admin/weddings/${cid}/cover`, {
        method: "PUT",
        body: { poster_url: "", hero_url: "", description: "" },
      });
      setPosterUrl("");
      setHeroUrl("");
      setDescription("");
      showAlert("🔄 Réinitialisé", "La couverture revient à l'image de la 1ère vidéo.");
    } catch (e: any) {
      showAlert("Erreur", e.message || "Impossible de réinitialiser");
    } finally {
      setSaving(false);
    }
  };

  const posterPreview = posterUrl ? (posterUrl.startsWith("http") ? posterUrl : `${BASE}${posterUrl}`) : "";
  const heroPreview = heroUrl ? (heroUrl.startsWith("http") ? heroUrl : `${BASE}${heroUrl}`) : "";

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
          <Text style={styles.title}>Couvertures du mariage</Text>
          <View style={{ width: 26 }} />
        </View>
        <ScrollView contentContainerStyle={styles.body}>
          <View style={styles.banner}>
            <Ionicons name="information-circle" size={20} color={colors.gold} />
            <Text style={styles.bannerTxt}>
              Ces images sont {"\u00AB"}propres au mariage{"\u00BB"} et s&apos;affichent dans le catalogue + sur la page du couple. Elles sont indépendantes des posters de chaque vidéo.
            </Text>
          </View>

          {/* POSTER */}
          <Text style={styles.label}>Couverture (poster) — affichée dans le catalogue</Text>
          <Text style={styles.help}>Format conseillé : portrait 9:16 (ex: 1080×1920)</Text>
          <View style={styles.previewBox}>
            {posterPreview ? (
              <Image source={{ uri: posterPreview }} style={styles.posterPreview} contentFit="cover" />
            ) : (
              <View style={[styles.posterPreview, styles.placeholder]}>
                <Ionicons name="image-outline" size={48} color={colors.textSecondary} />
                <Text style={styles.placeholderTxt}>Pas de couverture personnalisée</Text>
                <Text style={[styles.placeholderTxt, { fontSize: 11, marginTop: 4 }]}>
                  → l&apos;image de la 1ère vidéo sera utilisée
                </Text>
              </View>
            )}
          </View>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.uploadBtn} onPress={() => pickAndUpload("poster")} disabled={progress.poster !== undefined}>
              <Ionicons name="cloud-upload" size={18} color="#0A0A0A" />
              <Text style={styles.uploadTxt}>
                {progress.poster !== undefined ? `Upload ${progress.poster}%` : "Choisir une image"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ftpBtn} onPress={() => setFtpTarget("poster")}>
              <Ionicons name="folder-open" size={16} color={colors.gold} />
              <Text style={styles.ftpTxt}>FTP</Text>
            </TouchableOpacity>
          </View>
          {!!posterUrl && (
            <TouchableOpacity onPress={() => setPosterUrl("")} style={styles.clearLink}>
              <Text style={styles.clearLinkTxt}>✕ Retirer la couverture personnalisée</Text>
            </TouchableOpacity>
          )}

          {/* HERO */}
          <Text style={[styles.label, { marginTop: 28 }]}>Hero (grande image) — affichée en haut de la page du couple</Text>
          <Text style={styles.help}>Format conseillé : paysage 16:9 (ex: 1920×1080)</Text>
          <View style={styles.previewBox}>
            {heroPreview ? (
              <Image source={{ uri: heroPreview }} style={styles.heroPreview} contentFit="cover" />
            ) : (
              <View style={[styles.heroPreview, styles.placeholder]}>
                <Ionicons name="image-outline" size={48} color={colors.textSecondary} />
                <Text style={styles.placeholderTxt}>Pas de hero personnalisé</Text>
              </View>
            )}
          </View>
          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.uploadBtn} onPress={() => pickAndUpload("hero")} disabled={progress.hero !== undefined}>
              <Ionicons name="cloud-upload" size={18} color="#0A0A0A" />
              <Text style={styles.uploadTxt}>
                {progress.hero !== undefined ? `Upload ${progress.hero}%` : "Choisir une image"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.ftpBtn} onPress={() => setFtpTarget("hero")}>
              <Ionicons name="folder-open" size={16} color={colors.gold} />
              <Text style={styles.ftpTxt}>FTP</Text>
            </TouchableOpacity>
          </View>
          {!!heroUrl && (
            <TouchableOpacity onPress={() => setHeroUrl("")} style={styles.clearLink}>
              <Text style={styles.clearLinkTxt}>✕ Retirer le hero personnalisé</Text>
            </TouchableOpacity>
          )}

          {/* DESCRIPTION */}
          <Text style={[styles.label, { marginTop: 28 }]}>Description du mariage (optionnel)</Text>
          <TextInput
            style={styles.textarea}
            value={description}
            onChangeText={setDescription}
            placeholder="Ex: Une cérémonie féerique au Domaine de Verchant..."
            placeholderTextColor={colors.textSecondary}
            multiline
            numberOfLines={4}
          />

          {/* ACTIONS */}
          <TouchableOpacity style={styles.saveBtn} onPress={save} disabled={saving}>
            {saving ? <ActivityIndicator color="#0A0A0A" /> : (
              <>
                <Ionicons name="checkmark-circle" size={20} color="#0A0A0A" />
                <Text style={styles.saveTxt}>Enregistrer</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity onPress={clearAll} style={styles.resetBtn} disabled={saving}>
            <Ionicons name="refresh" size={16} color={colors.textSecondary} />
            <Text style={styles.resetTxt}>Réinitialiser (utiliser le poster de la 1ère vidéo)</Text>
          </TouchableOpacity>
        </ScrollView>

        <FtpPicker
          visible={ftpTarget !== null}
          onClose={() => setFtpTarget(null)}
          onPick={(filename) => {
            const url = `/api/uploads/${filename}`;
            if (ftpTarget === "poster") setPosterUrl(url);
            else if (ftpTarget === "hero") setHeroUrl(url);
            setFtpTarget(null);
          }}
        />
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(212,175,55,0.15)",
  },
  iconBtn: { padding: 6 },
  title: { color: colors.ivory, fontSize: 17, fontWeight: "700" },
  body: { padding: spacing.md, paddingBottom: 80 },
  banner: {
    flexDirection: "row",
    backgroundColor: "rgba(212,175,55,0.08)",
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    padding: 12,
    borderRadius: radii.sm,
    marginBottom: 24,
  },
  bannerTxt: { color: colors.ivory, fontSize: 12, marginLeft: 10, flex: 1, lineHeight: 17 },
  label: { color: colors.ivory, fontSize: 14, fontWeight: "700", marginBottom: 4 },
  help: { color: colors.textSecondary, fontSize: 11, marginBottom: 10 },
  previewBox: { borderRadius: radii.md, overflow: "hidden", backgroundColor: "rgba(255,255,255,0.04)" },
  posterPreview: { width: "100%", aspectRatio: 9 / 16, maxHeight: 400 },
  heroPreview: { width: "100%", aspectRatio: 16 / 9 },
  placeholder: { alignItems: "center", justifyContent: "center", padding: 32 },
  placeholderTxt: { color: colors.textSecondary, fontSize: 13, marginTop: 8 },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 12 },
  uploadBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.gold,
    paddingVertical: 12,
    borderRadius: radii.sm,
    gap: 6,
  },
  uploadTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 13 },
  ftpBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderColor: colors.gold,
    borderWidth: 1,
    borderRadius: radii.sm,
    gap: 6,
  },
  ftpTxt: { color: colors.gold, fontWeight: "700", fontSize: 12 },
  clearLink: { paddingVertical: 10, alignItems: "center" },
  clearLinkTxt: { color: "#ff7676", fontSize: 12 },
  textarea: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: radii.sm,
    padding: 12,
    color: colors.ivory,
    fontSize: 14,
    minHeight: 90,
    textAlignVertical: "top",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.2)",
  },
  saveBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.gold,
    paddingVertical: 14,
    borderRadius: radii.md,
    gap: 8,
    marginTop: 28,
  },
  saveTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 15 },
  resetBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    gap: 6,
    marginTop: 12,
  },
  resetTxt: { color: colors.textSecondary, fontSize: 12 },
});

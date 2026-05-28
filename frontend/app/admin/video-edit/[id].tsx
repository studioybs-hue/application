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
import { showAlert } from "@/src/utils/dialog";
import { colors, spacing, radii } from "@/src/theme";
import { FtpPicker } from "@/src/ui/FtpPicker";
import { NotifyPanel } from "@/src/admin/NotifyPanel";

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
  client_id: string;
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
  client_id: "",
};

type WeddingOption = {
  client_id: string;
  client_name: string;
  video_count: number;
  poster_url?: string;
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
  const [existingWeddings, setExistingWeddings] = useState<WeddingOption[]>([]);
  const [weddingPicker, setWeddingPicker] = useState<"new" | "existing">(isNew ? "new" : "existing");
  const [ftpPickerTarget, setFtpPickerTarget] = useState<"poster" | "hero" | "trailer" | "full" | null>(null);

  // Load existing weddings to allow attaching new videos to an existing one
  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ weddings: WeddingOption[] }>("/admin/weddings");
        setExistingWeddings(r.weddings || []);
      } catch {}
    })();
  }, []);

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
            client_name: v.client_name || "",
            client_id: v.client_id || "",
          });
        }
      } catch (e: any) {
        showAlert("Erreur", e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isNew]);

  const set = (k: keyof Form, v: any) => setForm((f) => ({ ...f, [k]: v }));

  const attachToExisting = (w: WeddingOption) => {
    setForm((f) => ({ ...f, client_id: w.client_id, client_name: w.client_name }));
    setWeddingPicker("existing");
  };

  const createNewWedding = () => {
    setForm((f) => ({ ...f, client_id: "" }));
    setWeddingPicker("new");
  };

  // Bulletproof file picker for web: bypass expo-document-picker entirely and use a
  // native HTML <input type="file"> element. This avoids any FileReader-based blocking
  // when the user picks a very large file (e.g. 2 GB). Returns the underlying File or null.
  const pickFileNativeWeb = (accept: string): Promise<File | null> => {
    return new Promise((resolve) => {
      try {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = accept;
        input.style.display = "none";
        const cleanup = () => {
          input.onchange = null;
          input.oncancel = null;
          if (input.parentNode) input.parentNode.removeChild(input);
        };
        input.onchange = () => {
          const f = input.files && input.files[0] ? input.files[0] : null;
          cleanup();
          resolve(f);
        };
        (input as any).oncancel = () => { cleanup(); resolve(null); };
        document.body.appendChild(input);
        input.click();
      } catch (e) {
        resolve(null);
      }
    });
  };

  const upload = async (target: "poster" | "trailer" | "full") => {
    const startedAt = Date.now();
    try {
      let asset: { uri: string; name?: string; mimeType?: string; size?: number; file?: File } | null = null;
      if (target === "poster") {
        if (Platform.OS === "web") {
          // Use native input for images too (consistent + reliable)
          const f = await pickFileNativeWeb("image/*");
          if (!f) return;
          asset = { uri: URL.createObjectURL(f), name: f.name, mimeType: f.type, size: f.size, file: f };
        } else {
          const r = await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ImagePicker.MediaTypeOptions.Images,
            quality: 0.9,
          });
          if (r.canceled || !r.assets?.[0]) return;
          asset = { uri: r.assets[0].uri, name: r.assets[0].fileName || "poster.jpg", mimeType: r.assets[0].mimeType, size: r.assets[0].fileSize };
        }
      } else {
        if (Platform.OS === "web") {
          // On web, bypass expo-document-picker (it can crash on 2GB+ files because of
          // internal FileReader usage). Use a native <input type="file"> instead.
          const f = await pickFileNativeWeb("video/*");
          if (!f) return;
          asset = { uri: URL.createObjectURL(f), name: f.name, mimeType: f.type, size: f.size, file: f };
        } else {
          const r = await DocumentPicker.getDocumentAsync({ type: "video/*", copyToCacheDirectory: false, base64: false } as any);
          if (r.canceled || !r.assets?.[0]) return;
          const a = r.assets[0] as any;
          asset = { uri: a.uri, name: a.name, mimeType: a.mimeType, size: a.size, file: a.file };
        }
      }
      setUploading(target);
      setProgress((p) => ({ ...p, [target]: 0 }));
      setUploadedStatus((s) => ({ ...s, [target]: false }));

      const token = await storage.secureGet<string>("ws_token", "");
      const isVideo = target !== "poster";

      // Convert asset to a Blob/File (needed for both flows)
      // CRITICAL: On web, prefer the native File object directly (zero-copy).
      // Calling `fetch(asset.uri).blob()` on a 2GB file would try to load the entire
      // file into memory and crash Chrome with "Failed to read the selected media".
      let blob: Blob;
      let fileName = asset.name || (isVideo ? "video.mp4" : "image.jpg");
      if (Platform.OS === "web" && (asset as any).file) {
        // expo-document-picker exposes the underlying File object on web
        blob = (asset as any).file as Blob;
        fileName = (asset as any).file.name || fileName;
      } else {
        blob = await (await fetch(asset.uri)).blob();
      }
      const fileSize = (blob as any).size || asset.size || 0;

      // Sanity check: refuse very large files that would fill the server disk
      const MAX_FILE_SIZE = 50 * 1024 * 1024 * 1024; // 50 GB hard cap (chunked upload supports very large files)
      if (fileSize > MAX_FILE_SIZE) {
        throw new Error(`Fichier trop volumineux (${Math.round(fileSize / (1024 * 1024 * 1024))} GB). Limite : 50 GB. Pour des fichiers plus volumineux, compressez en H.264 (~10 Mbps pour 4K, ~5 Mbps pour Full HD).`);
      }

      let result: { url: string };

      // ====== CHUNKED UPLOAD for videos (any size) or large images ======
      // Use 8 MB chunks for big files (better throughput, fewer round-trips)
      const CHUNK_SIZE = fileSize > 500 * 1024 * 1024 ? 8 * 1024 * 1024 : 5 * 1024 * 1024;
      const useChunked = isVideo || fileSize > 8 * 1024 * 1024;

      if (useChunked && fileSize > 0) {
        const totalChunks = Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));
        const uploadId = (typeof crypto !== "undefined" && (crypto as any).randomUUID)
          ? (crypto as any).randomUUID()
          : `up_${Date.now()}_${Math.random().toString(36).slice(2)}`;

        let finalUrl: string | null = null;

        for (let i = 0; i < totalChunks; i++) {
          const start = i * CHUNK_SIZE;
          const end = Math.min(start + CHUNK_SIZE, fileSize);
          const chunk = blob.slice(start, end);

          const fd = new FormData();
          fd.append("upload_id", uploadId);
          fd.append("chunk_index", String(i));
          fd.append("total_chunks", String(totalChunks));
          fd.append("kind", isVideo ? "video" : "image");
          fd.append("filename", fileName);
          fd.append("file", chunk, `${fileName}.part${i}`);

          const chunkResult = await new Promise<{ url?: string; ok: boolean }>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", `${BASE}/api/admin/upload-chunk`);
            xhr.setRequestHeader("Authorization", `Bearer ${token}`);
            xhr.timeout = 5 * 60 * 1000; // 5 min per chunk
            xhr.upload.onprogress = (ev: any) => {
              if (ev.lengthComputable) {
                const chunkPct = ev.loaded / ev.total;
                // Overall progress accounts for completed chunks + this chunk's progress
                const overallPct = Math.round(((i + chunkPct) / totalChunks) * 100);
                setProgress((p) => ({ ...p, [target]: Math.min(99, overallPct) }));
              }
            };
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                try { resolve(JSON.parse(xhr.responseText)); }
                catch { resolve({ ok: true }); }
              } else {
                try {
                  const err = JSON.parse(xhr.responseText);
                  reject(new Error(err.detail || `HTTP ${xhr.status}`));
                } catch {
                  reject(new Error(`Erreur ${xhr.status} sur le chunk ${i + 1}/${totalChunks}`));
                }
              }
            };
            xhr.onerror = () => reject(new Error(`Erreur réseau sur le chunk ${i + 1}/${totalChunks}. Vérifiez votre connexion et réessayez.`));
            xhr.ontimeout = () => reject(new Error(`Timeout sur le chunk ${i + 1}/${totalChunks}`));
            xhr.send(fd as any);
          });

          if (chunkResult.url) finalUrl = chunkResult.url;
        }

        if (!finalUrl) throw new Error("Le serveur n'a pas renvoyé l'URL finale. Réessayez l'upload.");
        result = { url: finalUrl };
      } else {
        // ====== SINGLE-SHOT UPLOAD (small images) ======
        const fd = new FormData();
        fd.append("kind", isVideo ? "video" : "image");
        fd.append("file", blob, fileName);

        result = await new Promise<{ url: string }>((resolve, reject) => {
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
              try { resolve(JSON.parse(xhr.responseText)); }
              catch { reject(new Error("Réponse invalide du serveur")); }
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
      }

      // Minimum 800ms visible so the user sees the gauge even for fast uploads
      const elapsed = Date.now() - startedAt;
      if (elapsed < 800) await new Promise((r) => setTimeout(r, 800 - elapsed));

      if (target === "poster") set("poster_url", result.url);
      else if (target === "trailer") set("trailer_url", result.url);
      else set("full_url", result.url);

      setProgress((p) => ({ ...p, [target]: 100 }));
      setUploadedStatus((s) => ({ ...s, [target]: true }));
    } catch (e: any) {
      showAlert("Erreur d'upload", e.message || "Téléversement échoué. Vérifiez votre connexion ou essayez un fichier plus petit.");
      setProgress((p) => ({ ...p, [target]: undefined }));
    } finally {
      setUploading(null);
    }
  };

  const save = async () => {
    if (!form.title.trim()) {
      showAlert("Erreur", "Le titre est requis");
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
      showAlert("Erreur", e.message);
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
          {/* WEDDING SELECTOR — attach to existing OR create new */}
          <Field label="Mariage *">
            <View style={styles.weddingTabs}>
              <TouchableOpacity
                style={[styles.weddingTab, weddingPicker === "existing" && styles.weddingTabActive]}
                onPress={() => setWeddingPicker("existing")}
              >
                <Ionicons name="people" size={14} color={weddingPicker === "existing" ? "#0A0A0A" : colors.ivory} />
                <Text style={[styles.weddingTabTxt, weddingPicker === "existing" && { color: "#0A0A0A", fontWeight: "700" }]}>Mariage existant</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.weddingTab, weddingPicker === "new" && styles.weddingTabActive]}
                onPress={createNewWedding}
              >
                <Ionicons name="add-circle" size={14} color={weddingPicker === "new" ? "#0A0A0A" : colors.ivory} />
                <Text style={[styles.weddingTabTxt, weddingPicker === "new" && { color: "#0A0A0A", fontWeight: "700" }]}>Nouveau mariage</Text>
              </TouchableOpacity>
            </View>

            {weddingPicker === "existing" ? (
              existingWeddings.length === 0 ? (
                <Text style={styles.hint}>Aucun mariage existant. Crée d'abord une vidéo en mode « Nouveau mariage ».</Text>
              ) : (
                <View style={{ marginTop: 8 }}>
                  {existingWeddings.map((w) => {
                    const selected = form.client_id === w.client_id;
                    return (
                      <TouchableOpacity
                        key={w.client_id}
                        style={[styles.weddingRow, selected && styles.weddingRowSelected]}
                        onPress={() => attachToExisting(w)}
                        testID={`pick-wedding-${w.client_id}`}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={[styles.weddingRowName, selected && { color: colors.gold }]}>
                            {selected ? "✓ " : ""}{w.client_name}
                          </Text>
                          <Text style={styles.weddingRowMeta}>
                            id: {w.client_id} · {w.video_count} vidéo{w.video_count > 1 ? "s" : ""}
                          </Text>
                        </View>
                        {selected && <Ionicons name="checkmark-circle" size={20} color={colors.gold} />}
                      </TouchableOpacity>
                    );
                  })}
                  <Text style={styles.hint}>📌 La nouvelle vidéo sera rattachée à ce mariage. Le code unique du mariage débloquera aussi cette vidéo.</Text>
                </View>
              )
            ) : (
              <View style={{ marginTop: 8 }}>
                <TextInput
                  style={styles.input}
                  value={form.client_name}
                  onChangeText={(t) => set("client_name", t)}
                  placeholder="Ex: Camille & Antoine"
                  placeholderTextColor={colors.textDisabled}
                  testID="video-client-name-input"
                />
                <Text style={styles.hint}>📌 Un nouveau mariage sera créé. Toutes les futures vidéos pourront être attachées à ce mariage depuis l'onglet « Mariage existant ».</Text>
              </View>
            )}
          </Field>

          <Field label="Titre de la vidéo *">
            <TextInput style={styles.input} value={form.title} onChangeText={(t) => set("title", t)} placeholder="Ex: Cérémonie civile" placeholderTextColor={colors.textDisabled} testID="video-title-input" />
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
            <FtpButton onPress={() => setFtpPickerTarget("poster")} />
          </Field>

          <Field label="Hero (image grand format)">
            <TextInput style={styles.input} value={form.hero_url} onChangeText={(t) => set("hero_url", t)} placeholder="URL (vide = utilise le poster)" placeholderTextColor={colors.textDisabled} autoCapitalize="none" />
            <FtpButton onPress={() => setFtpPickerTarget("hero")} />
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
            <FtpButton onPress={() => setFtpPickerTarget("trailer")} />
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
            <FtpButton onPress={() => setFtpPickerTarget("full")} />
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

          {/* NOTIFICATION PANEL — only when video exists and has a full_url */}
          {!isNew && !!form.full_url && (
            <NotifyPanel videoId={id as string} clientName={form.client_name} />
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* FTP picker modal */}
      <FtpPicker
        visible={ftpPickerTarget !== null}
        onClose={() => setFtpPickerTarget(null)}
        target={ftpPickerTarget || "poster"}
        videoId={isNew ? undefined : (id as string)}
        filterExt={ftpPickerTarget === "poster" || ftpPickerTarget === "hero" ? ["jpg", "jpeg", "png", "webp", "avif"] : ["mp4", "mov", "m4v", "webm", "mkv", "avi"]}
        onPicked={(url) => {
          if (ftpPickerTarget === "poster") set("poster_url", url);
          else if (ftpPickerTarget === "hero") set("hero_url", url);
          else if (ftpPickerTarget === "trailer") set("trailer_url", url);
          else if (ftpPickerTarget === "full") set("full_url", url);
        }}
      />
    </SafeAreaView>
  );
}

/** Bouton "📁 Depuis FTP/Serveur" — alternative aux upload navigateur pour les gros fichiers. */
function FtpButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.ftpBtn} onPress={onPress}>
      <Ionicons name="server-outline" size={16} color={colors.gold} />
      <Text style={styles.ftpBtnTxt}>Importer depuis le serveur (FTP/FileZilla)</Text>
    </TouchableOpacity>
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
          <ActivityIndicator size="small" color={colors.gold} />
          <Text style={styles.progressLabel}>
            {pct === 0 ? "Préparation du fichier…" : `Téléversement en cours… ${pct}%`}
          </Text>
        </View>
        <View style={styles.progressTrack}>
          <View style={[styles.progressFill, { width: `${Math.max(pct, 5)}%` }]} />
        </View>
        <Text style={styles.progressHint}>
          ⏳ Ne quittez pas cette page tant que la jauge n&apos;est pas verte.
        </Text>
      </View>
    );
  }
  if (done) {
    return (
      <View style={styles.uploadDone} testID={`${testID}-done`}>
        <Ionicons name="checkmark-circle" size={20} color={colors.success} />
        <Text style={styles.uploadDoneTxt}>Fichier téléversé ✓</Text>
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
  weddingTabs: { flexDirection: "row", gap: 8, marginBottom: 4 },
  weddingTab: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 10, borderRadius: radii.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  weddingTabActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  weddingTabTxt: { color: colors.ivory, fontSize: 13, fontWeight: "600" },
  weddingRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, padding: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border, marginBottom: 6 },
  weddingRowSelected: { borderColor: colors.gold, backgroundColor: "rgba(212,175,55,0.08)" },
  weddingRowName: { color: colors.ivory, fontSize: 14, fontWeight: "700" },
  weddingRowMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  input: { backgroundColor: colors.surface, color: colors.ivory, borderRadius: radii.sm, paddingHorizontal: spacing.md, paddingVertical: 14, fontSize: 14, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipTxt: { color: colors.ivory, fontSize: 13 },
  posterPreview: { width: 100, height: 150, borderRadius: 6, marginBottom: 8 },
  uploadBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, marginTop: 8, paddingVertical: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border, borderStyle: "dashed" },
  uploadTxt: { color: colors.gold, fontWeight: "600", fontSize: 13 },
  progressContainer: { marginTop: 8, padding: 14, borderRadius: radii.sm, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.gold },
  progressHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  progressLabel: { color: colors.ivory, fontSize: 14, fontWeight: "700" },
  progressTrack: { height: 10, backgroundColor: "rgba(255,255,255,0.08)", borderRadius: 5, overflow: "hidden" },
  progressFill: { height: 10, backgroundColor: colors.gold, borderRadius: 5 },
  progressHint: { color: colors.textSecondary, fontSize: 11, marginTop: 8, fontStyle: "italic" },
  uploadDone: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 8, padding: 14, borderRadius: radii.sm, backgroundColor: "rgba(46,125,50,0.15)", borderWidth: 1.5, borderColor: colors.success },
  uploadDoneTxt: { color: colors.ivory, fontSize: 14, fontWeight: "700", flex: 1 },
  uploadReplaceTxt: { color: colors.gold, fontSize: 13, fontWeight: "700", textDecorationLine: "underline" },
  ftpBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 8, paddingVertical: 10, paddingHorizontal: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.gold, borderStyle: "dashed", backgroundColor: "rgba(212,175,55,0.04)" },
  ftpBtnTxt: { color: colors.gold, fontSize: 12, fontWeight: "600" },
  switchRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.sm, marginBottom: spacing.sm },
  saveBtn: { backgroundColor: colors.gold, paddingVertical: 16, borderRadius: radii.sm, alignItems: "center", marginTop: spacing.lg },
  saveTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15, letterSpacing: 0.5 },
});

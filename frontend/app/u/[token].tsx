import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Platform,
} from "react-native";
import * as DocumentPicker from "expo-document-picker";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert, confirmAction } from "@/src/utils/dialog";

const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";

type UploadedFile = {
  name: string;
  stored_as: string;
  size: number;
  uploaded_at: string;
};

type Info = {
  ok: boolean;
  couple_name: string;
  status: string;
  message?: string;
  uploaded_files: UploadedFile[];
};

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export default function PublicUploadScreen() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [info, setInfo] = useState<Info | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentFile, setCurrentFile] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${BACKEND_URL}/api/hosting/upload/${token}`);
      if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || "Lien invalide");
      }
      const data = await r.json();
      setInfo(data);
    } catch (e: any) {
      setInfo({ ok: false, couple_name: "", status: "error", message: e.message, uploaded_files: [] });
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { load(); }, [load]);

  const uploadFile = (file: File): Promise<void> => {
    const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB per chunk
    const fileSize = file.size;
    // For files > 50MB, use chunked upload to bypass proxy limits and avoid timeouts
    const useChunked = fileSize > 50 * 1024 * 1024;

    if (!useChunked) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const form = new FormData();
        form.append("file", file);
        xhr.open("POST", `${BACKEND_URL}/api/hosting/upload/${token}/file`);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) resolve();
          else {
            try {
              const err = JSON.parse(xhr.responseText);
              reject(new Error(err.detail || `Erreur ${xhr.status}`));
            } catch { reject(new Error(`Erreur ${xhr.status}`)); }
          }
        };
        xhr.onerror = () => reject(new Error("Erreur réseau pendant l'upload"));
        xhr.send(form);
      });
    }

    // CHUNKED UPLOAD for large files
    const totalChunks = Math.max(1, Math.ceil(fileSize / CHUNK_SIZE));
    const uploadId = (typeof crypto !== "undefined" && (crypto as any).randomUUID)
      ? (crypto as any).randomUUID()
      : `up_${Date.now()}_${Math.random().toString(36).slice(2)}`;

    return (async () => {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, fileSize);
        const chunk = file.slice(start, end);

        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          const form = new FormData();
          form.append("upload_id", uploadId);
          form.append("chunk_index", String(i));
          form.append("total_chunks", String(totalChunks));
          form.append("filename", file.name);
          form.append("file", chunk, `${file.name}.part${i}`);

          xhr.open("POST", `${BACKEND_URL}/api/hosting/upload/${token}/chunk`);
          xhr.timeout = 5 * 60 * 1000;
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              const chunkPct = e.loaded / e.total;
              const overallPct = Math.round(((i + chunkPct) / totalChunks) * 100);
              setProgress(Math.min(99, overallPct));
            }
          };
          xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) resolve();
            else {
              try {
                const err = JSON.parse(xhr.responseText);
                reject(new Error(err.detail || `Erreur ${xhr.status} sur le chunk ${i + 1}/${totalChunks}`));
              } catch { reject(new Error(`Erreur ${xhr.status} sur le chunk ${i + 1}/${totalChunks}`)); }
            }
          };
          xhr.onerror = () => reject(new Error(`Erreur réseau sur le chunk ${i + 1}/${totalChunks}. Vérifiez votre connexion.`));
          xhr.ontimeout = () => reject(new Error(`Timeout sur le chunk ${i + 1}/${totalChunks}`));
          xhr.send(form);
        });
      }
      setProgress(100);
    })();
  };

  const pickAndUpload = async () => {
    try {
      const res = await DocumentPicker.getDocumentAsync({
        multiple: true,
        copyToCacheDirectory: false,
      });
      if (res.canceled || !res.assets || res.assets.length === 0) return;
      setUploading(true);
      for (const asset of res.assets) {
        setCurrentFile(asset.name);
        setProgress(0);
        try {
          let fileObj: File;
          if (Platform.OS === "web") {
            // On web, asset.file is the File object
            fileObj = (asset as any).file as File;
            if (!fileObj) {
              const blob = await fetch(asset.uri).then((r) => r.blob());
              fileObj = new File([blob], asset.name, { type: asset.mimeType || "application/octet-stream" });
            }
          } else {
            // Native: fetch the uri to get blob, then wrap as File-like
            const blob = await fetch(asset.uri).then((r) => r.blob());
            fileObj = new File([blob], asset.name, { type: asset.mimeType || "application/octet-stream" });
          }
          await uploadFile(fileObj);
        } catch (e: any) {
          showAlert("Erreur", `${asset.name} : ${e.message}`);
        }
      }
      await load();
      showAlert("✓ Envoi terminé", "Vos fichiers ont bien été reçus. Notre équipe va commencer le montage.");
    } catch (e: any) {
      showAlert("Erreur", e.message);
    } finally {
      setUploading(false);
      setProgress(0);
      setCurrentFile(null);
    }
  };

  const deleteFile = (f: UploadedFile) => {
    confirmAction(
      "Supprimer ce fichier",
      `Voulez-vous vraiment retirer « ${f.name} » de votre envoi ?`,
      async () => {
        try {
          await fetch(`${BACKEND_URL}/api/hosting/upload/${token}/file/${f.stored_as}`, { method: "DELETE" });
          await load();
        } catch (e: any) {
          showAlert("Erreur", e.message);
        }
      },
      { destructive: true }
    );
  };

  return (
    <View style={styles.root}>
      <LinearGradient colors={[colors.burgundy, colors.bg]} style={StyleSheet.absoluteFillObject} />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.brandRow}>
            <Ionicons name="film" size={28} color={colors.gold} />
            <Text style={styles.brand}>CINÉMARIÉS</Text>
          </View>

          {loading ? (
            <ActivityIndicator color={colors.gold} size="large" style={{ marginTop: 80 }} />
          ) : !info?.ok && info?.status === "error" ? (
            <View style={styles.errorCard}>
              <Ionicons name="warning" size={36} color={colors.error} />
              <Text style={styles.errorTitle}>Lien invalide</Text>
              <Text style={styles.errorSub}>{info.message || "Ce lien n'existe pas ou a expiré."}</Text>
            </View>
          ) : !info?.ok && info?.status === "pending_payment" ? (
            <View style={styles.warnCard}>
              <Ionicons name="hourglass" size={32} color={colors.gold} />
              <Text style={styles.warnTitle}>En attente du paiement</Text>
              <Text style={styles.warnSub}>{info.message}</Text>
              <Text style={[styles.warnSub, { marginTop: 8 }]}>
                Mariage : <Text style={{ color: colors.gold, fontWeight: "700" }}>{info.couple_name}</Text>
              </Text>
            </View>
          ) : (
            <>
              <Text style={styles.title}>Déposez vos vidéos brutes</Text>
              <Text style={styles.subtitle}>
                Mariage : <Text style={{ color: colors.gold, fontWeight: "700" }}>{info?.couple_name}</Text>
              </Text>

              <View style={styles.helperCard}>
                <Ionicons name="information-circle" size={18} color={colors.gold} />
                <Text style={styles.helperTxt}>
                  Lien sécurisé personnel. Multi-fichiers, jusqu'à 50 Go par fichier. Notre équipe est notifiée à chaque envoi.
                </Text>
              </View>

              <TouchableOpacity
                style={styles.uploadBtn}
                onPress={pickAndUpload}
                disabled={uploading}
                testID="upload-btn"
              >
                {uploading ? (
                  <View style={{ alignItems: "center", width: "100%" }}>
                    <Text style={styles.uploadingTxt}>Envoi en cours…</Text>
                    {currentFile && <Text style={styles.uploadingFile} numberOfLines={1}>{currentFile}</Text>}
                    <View style={styles.progressBg}>
                      <View style={[styles.progressFill, { width: `${progress}%` }]} />
                    </View>
                    <Text style={styles.progressTxt}>{progress}%</Text>
                  </View>
                ) : (
                  <>
                    <Ionicons name="cloud-upload" size={28} color="#0A0A0A" />
                    <Text style={styles.uploadTxt}>Choisir des fichiers à envoyer</Text>
                    <Text style={styles.uploadHint}>Vidéos, photos, audio acceptés</Text>
                  </>
                )}
              </TouchableOpacity>

              <Text style={styles.sectionTitle}>
                Fichiers déjà envoyés ({info?.uploaded_files.length || 0})
              </Text>
              {(info?.uploaded_files || []).length === 0 ? (
                <Text style={styles.empty}>Aucun fichier pour l'instant. Cliquez ci-dessus pour commencer.</Text>
              ) : (
                info!.uploaded_files.map((f) => (
                  <View key={f.stored_as} style={styles.fileRow}>
                    <Ionicons name="film-outline" size={20} color={colors.gold} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                      <Text style={styles.fileMeta}>
                        {humanSize(f.size)} · {new Date(f.uploaded_at).toLocaleString("fr-FR")}
                      </Text>
                    </View>
                    <TouchableOpacity onPress={() => deleteFile(f)} disabled={uploading}>
                      <Ionicons name="trash-outline" size={18} color={colors.error} />
                    </TouchableOpacity>
                  </View>
                ))
              )}
            </>
          )}

          <View style={{ height: 40 }} />
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  brandRow: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", marginBottom: spacing.lg },
  brand: { color: colors.gold, fontSize: 22, fontWeight: "800", letterSpacing: 3 },
  title: { color: colors.ivory, fontSize: 24, fontWeight: "700", textAlign: "center" },
  subtitle: { color: colors.textSecondary, fontSize: 14, textAlign: "center", marginTop: 6, marginBottom: spacing.lg },
  helperCard: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "rgba(212,175,55,0.08)", borderWidth: 1, borderColor: colors.gold, borderRadius: 8, padding: 12, marginBottom: spacing.lg },
  helperTxt: { color: colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 18 },
  uploadBtn: { backgroundColor: colors.gold, padding: 24, borderRadius: radii.lg, alignItems: "center", justifyContent: "center", marginBottom: spacing.lg, minHeight: 120, gap: 6 },
  uploadTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 16, marginTop: 6 },
  uploadHint: { color: "rgba(0,0,0,0.6)", fontSize: 11, fontStyle: "italic" },
  uploadingTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 14 },
  uploadingFile: { color: "rgba(0,0,0,0.7)", fontSize: 11, marginTop: 4, marginBottom: 10 },
  progressBg: { width: "100%", height: 6, backgroundColor: "rgba(0,0,0,0.2)", borderRadius: 3, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#0A0A0A" },
  progressTxt: { color: "#0A0A0A", fontSize: 12, fontWeight: "700", marginTop: 6 },
  sectionTitle: { color: colors.gold, fontSize: 13, fontWeight: "700", letterSpacing: 1, marginBottom: 10 },
  empty: { color: colors.textSecondary, fontStyle: "italic", textAlign: "center", paddingVertical: spacing.md },
  fileRow: { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.surface, padding: 12, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  fileName: { color: colors.ivory, fontSize: 13, fontWeight: "600" },
  fileMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  errorCard: { alignItems: "center", padding: spacing.lg, marginTop: 60, gap: 8 },
  errorTitle: { color: colors.ivory, fontSize: 20, fontWeight: "700" },
  errorSub: { color: colors.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 18 },
  warnCard: { alignItems: "center", padding: spacing.lg, backgroundColor: "rgba(212,175,55,0.08)", borderRadius: radii.md, borderWidth: 1, borderColor: colors.gold, gap: 8, marginTop: 40 },
  warnTitle: { color: colors.ivory, fontSize: 18, fontWeight: "700" },
  warnSub: { color: colors.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 18 },
});

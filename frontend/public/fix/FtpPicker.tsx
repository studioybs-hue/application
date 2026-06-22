import { useEffect, useState } from "react";
import {
  View, Text, StyleSheet, Modal, TouchableOpacity, ScrollView, ActivityIndicator, Image, Platform,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radii } from "@/src/theme";
import { api } from "@/src/api/client";
import { showAlert, confirmAction } from "@/src/utils/dialog";
import { storage } from "@/src/utils/storage";

type FtpFile = { name: string; size: number; size_human: string; modified: string; ext: string };

interface Props {
  visible: boolean;
  onClose: () => void;
  onPicked: (url: string) => void;
  target: "poster" | "hero" | "trailer" | "full";
  videoId?: string;
  filterExt?: string[];
}

const VIDEO_EXTS = ["mp4", "mov", "m4v", "webm", "mkv"];
const IMAGE_EXTS = ["jpg", "jpeg", "png", "webp", "gif"];

function buildBackendUrl(path: string): string {
  const base = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

export function FtpPicker({ visible, onClose, onPicked, target, videoId, filterExt }: Props) {
  const [files, setFiles] = useState<FtpFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [dropPath, setDropPath] = useState<string>("");
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [preview, setPreview] = useState<{ filename: string; url: string } | null>(null);
  const [previewLoading, setPreviewLoading] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const r = await api<{ items: FtpFile[]; drop_path: string }>("/admin/ftp-files");
      let items = r.items || [];
      if (filterExt?.length) {
        const allowed = filterExt.map((e) => e.toLowerCase());
        items = items.filter((f) => allowed.includes(f.ext));
      }
      setFiles(items);
      setDropPath(r.drop_path);
      loadThumbs(items);
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Impossible de charger les fichiers FTP");
    } finally {
      setLoading(false);
    }
  };

  const loadThumbs = async (items: FtpFile[]) => {
    const token = await storage.getItem<string>("ws_token", "");
    if (!token) return;
    const newThumbs: Record<string, string> = {};
    await Promise.all(
      items.map(async (f) => {
        if (![...VIDEO_EXTS, ...IMAGE_EXTS].includes(f.ext)) return;
        try {
          const url = buildBackendUrl(`/api/admin/ftp-files/thumbnail/${encodeURIComponent(f.name)}`);
          const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
          if (!res.ok) return;
          const blob = await res.blob();
          const dataUrl: string = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
          newThumbs[f.name] = dataUrl;
          setThumbs((prev) => ({ ...prev, [f.name]: dataUrl }));
        } catch {
          // Ignore - keep icon fallback
        }
      })
    );
  };

  useEffect(() => {
    if (visible) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const importFile = async (f: FtpFile) => {
    setImporting(f.name);
    try {
      const r = await api<{ url: string }>("/admin/ftp-files/import", {
        method: "POST",
        body: { filename: f.name, target, video_id: videoId },
      });
      onPicked(r.url);
      showAlert("Importé ✅", `Fichier importé : ${f.name}`);
      onClose();
    } catch (e: any) {
      showAlert("Erreur d'import", e?.message || "Échec de l'import");
    } finally {
      setImporting(null);
    }
  };

  const openPreview = async (f: FtpFile) => {
    setPreviewLoading(f.name);
    try {
      const r = await api<{ token: string }>(
        `/admin/ftp-files/preview-token/${encodeURIComponent(f.name)}`,
        { method: "POST" }
      );
      const url = buildBackendUrl(
        `/api/admin/ftp-files/preview/${encodeURIComponent(f.name)}?token=${encodeURIComponent(r.token)}`
      );
      setPreview({ filename: f.name, url });
    } catch (e: any) {
      showAlert("Erreur aperçu", e?.message || "Impossible de générer l'aperçu");
    } finally {
      setPreviewLoading(null);
    }
  };

  const deleteFile = (f: FtpFile) => {
    confirmAction(
      "Supprimer ce fichier",
      `Supprimer définitivement "${f.name}" du dossier ftp_drop ?`,
      async () => {
        try {
          await api(`/admin/ftp-files/${encodeURIComponent(f.name)}`, { method: "DELETE" });
          await load();
        } catch (e: any) {
          showAlert("Erreur", e?.message || "Échec suppression");
        }
      },
      { confirmText: "Supprimer", destructive: true }
    );
  };

  return (
    <>
      <Modal visible={visible} animationType="slide" onRequestClose={onClose} transparent>
        <View style={styles.backdrop}>
          <View style={styles.card}>
            <View style={styles.header}>
              <Text style={styles.title}>📁 Importer depuis le serveur (FTP/SFTP)</Text>
              <TouchableOpacity onPress={onClose} hitSlop={10}>
                <Ionicons name="close" size={24} color={colors.ivory} />
              </TouchableOpacity>
            </View>

            <Text style={styles.hint}>
              Déposez d&apos;abord vos fichiers via FileZilla/WinSCP dans :{"\n"}
              <Text style={styles.path}>{dropPath || "/var/www/cinemaries/backend/uploads/ftp_drop/"}</Text>
            </Text>

            <View style={styles.toolbar}>
              <TouchableOpacity style={styles.refreshBtn} onPress={load}>
                <Ionicons name="refresh" size={16} color={colors.gold} />
                <Text style={styles.refreshTxt}>Rafraîchir</Text>
              </TouchableOpacity>
              <Text style={styles.count}>{files.length} fichier{files.length > 1 ? "s" : ""}</Text>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: spacing.lg }}>
              {loading ? (
                <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} />
              ) : files.length === 0 ? (
                <View style={styles.empty}>
                  <Ionicons name="cloud-upload-outline" size={48} color={colors.textDisabled} />
                  <Text style={styles.emptyTxt}>Aucun fichier disponible.{"\n"}Déposez-en via FileZilla puis cliquez Rafraîchir.</Text>
                </View>
              ) : (
                files.map((f) => {
                  const isVideo = VIDEO_EXTS.includes(f.ext);
                  const thumb = thumbs[f.name];
                  return (
                    <View key={f.name} style={styles.fileRow}>
                      {thumb ? (
                        <View style={styles.thumbWrap}>
                          <Image source={{ uri: thumb }} style={styles.thumb} />
                          {isVideo && (
                            <View style={styles.thumbPlay} pointerEvents="none">
                              <Ionicons name="play" size={14} color="#FFF" />
                            </View>
                          )}
                        </View>
                      ) : (
                        <View style={styles.fileIcon}>
                          <Ionicons
                            name={isVideo ? "videocam" : IMAGE_EXTS.includes(f.ext) ? "image" : "document"}
                            size={20}
                            color={colors.gold}
                          />
                        </View>
                      )}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.fileName} numberOfLines={1}>{f.name}</Text>
                        <Text style={styles.fileMeta}>{f.size_human} · {new Date(f.modified).toLocaleString("fr-FR")}</Text>
                      </View>
                      {isVideo && (
                        <TouchableOpacity
                          style={styles.previewBtn}
                          onPress={() => openPreview(f)}
                          disabled={previewLoading === f.name}
                          accessibilityLabel="Aperçu vidéo"
                        >
                          {previewLoading === f.name ? (
                            <ActivityIndicator size="small" color={colors.gold} />
                          ) : (
                            <Ionicons name="play-circle-outline" size={20} color={colors.gold} />
                          )}
                        </TouchableOpacity>
                      )}
                      <TouchableOpacity
                        style={styles.importBtn}
                        onPress={() => importFile(f)}
                        disabled={importing === f.name}
                      >
                        {importing === f.name ? (
                          <ActivityIndicator size="small" color="#0A0A0A" />
                        ) : (
                          <Text style={styles.importTxt}>Importer</Text>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.delBtn} onPress={() => deleteFile(f)}>
                        <Ionicons name="trash-outline" size={16} color="#E53935" />
                      </TouchableOpacity>
                    </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Preview modal */}
      <Modal visible={!!preview} animationType="fade" transparent onRequestClose={() => setPreview(null)}>
        <View style={styles.previewBackdrop}>
          <View style={styles.previewCard}>
            <View style={styles.previewHeader}>
              <Text style={styles.previewTitle} numberOfLines={1}>
                🎬 {preview?.filename}
              </Text>
              <TouchableOpacity onPress={() => setPreview(null)} hitSlop={10}>
                <Ionicons name="close" size={24} color={colors.ivory} />
              </TouchableOpacity>
            </View>
            <Text style={styles.previewHint}>
              Aperçu de 15 secondes (à partir de 0:30). Génération à la 1ère ouverture (~30s).
            </Text>
            {preview && Platform.OS === "web" ? (
              // @ts-expect-error HTML video element only on web
              <video
                src={preview.url}
                controls
                autoPlay
                style={{ width: "100%", maxHeight: 480, backgroundColor: "#000", borderRadius: 8 }}
              />
            ) : preview ? (
              <View style={{ width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000", alignItems: "center", justifyContent: "center", borderRadius: 8 }}>
                <Text style={{ color: colors.textSecondary, fontSize: 12 }}>
                  Aperçu disponible uniquement sur la version web.
                </Text>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.85)", justifyContent: "flex-end" },
  card: { backgroundColor: colors.bg, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, padding: spacing.md, maxHeight: "85%", borderWidth: 1, borderColor: colors.gold, borderBottomWidth: 0 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  title: { color: colors.ivory, fontSize: 16, fontWeight: "700", flex: 1 },
  hint: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.md, lineHeight: 18 },
  path: { color: colors.gold, fontFamily: "monospace", fontSize: 11 },
  toolbar: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm, paddingBottom: spacing.sm, borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.08)" },
  refreshBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 6, borderWidth: 1, borderColor: colors.gold },
  refreshTxt: { color: colors.gold, fontSize: 13, fontWeight: "600" },
  count: { color: colors.textSecondary, fontSize: 12 },
  empty: { alignItems: "center", marginTop: 40, gap: 12, paddingHorizontal: spacing.lg },
  emptyTxt: { color: colors.textDisabled, fontSize: 13, textAlign: "center", lineHeight: 18 },
  fileRow: { flexDirection: "row", alignItems: "center", padding: spacing.sm, gap: 10, backgroundColor: colors.surface, marginBottom: 6, borderRadius: radii.sm, borderWidth: 1, borderColor: "rgba(255,255,255,0.04)" },
  fileIcon: { width: 56, height: 56, borderRadius: 8, backgroundColor: "rgba(212,175,55,0.1)", alignItems: "center", justifyContent: "center" },
  thumbWrap: { width: 80, height: 56, borderRadius: 8, overflow: "hidden", backgroundColor: "#000", position: "relative" },
  thumb: { width: 80, height: 56, resizeMode: "cover" },
  thumbPlay: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)" },
  fileName: { color: colors.ivory, fontSize: 13, fontWeight: "600" },
  fileMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  previewBtn: { padding: 8, borderRadius: 4, borderWidth: 1, borderColor: colors.gold },
  importBtn: { backgroundColor: colors.gold, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 4 },
  importTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 12 },
  delBtn: { padding: 8 },

  // Preview modal styles
  previewBackdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.92)", alignItems: "center", justifyContent: "center", padding: spacing.md },
  previewCard: { width: "100%", maxWidth: 720, backgroundColor: colors.bg, borderRadius: radii.md, padding: spacing.md, borderWidth: 1, borderColor: colors.gold },
  previewHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  previewTitle: { color: colors.ivory, fontSize: 14, fontWeight: "700", flex: 1, marginRight: spacing.sm },
  previewHint: { color: colors.textSecondary, fontSize: 11, marginBottom: spacing.sm, fontStyle: "italic" },
});

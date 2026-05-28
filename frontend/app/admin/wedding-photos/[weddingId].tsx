/**
 * Admin — Galerie photo d'un mariage
 * Scanner SFTP, upload direct, upload musique, suppression.
 */
import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  Alert, FlatList, Dimensions, Platform,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert } from "@/src/utils/dialog";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const TOKEN_KEY_NAME = "ws_token";
const { width: SCREEN_W } = Dimensions.get("window");
const ITEM_SIZE = (SCREEN_W - 48) / 3;

type PhotoStats = {
  wedding_id: string;
  photos_count: number;
  storage_bytes: number;
  disk_files_count: number;
  needs_scan: boolean;
  music_filename: string | null;
  music_size: number;
  max_photos: number;
  originals_path: string;
};

type PhotoOut = {
  id: string;
  filename: string;
  thumb_url: string;
  full_url: string;
};

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function AdminWeddingPhotosScreen() {
  const router = useRouter();
  const { weddingId } = useLocalSearchParams<{ weddingId: string }>();
  const [stats, setStats] = useState<PhotoStats | null>(null);
  const [photos, setPhotos] = useState<PhotoOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingMusic, setUploadingMusic] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, p] = await Promise.all([
        api<PhotoStats>(`/admin/weddings/${weddingId}/photos/stats`),
        api<PhotoOut[]>(`/weddings/${weddingId}/photos?page=1&per_page=100`).catch(() => [] as PhotoOut[]),
      ]);
      setStats(s);
      setPhotos(p);
    } catch (e: any) {
      showAlert("Erreur", e.message);
    } finally {
      setLoading(false);
    }
  }, [weddingId]);

  useEffect(() => {
    if (weddingId) load();
  }, [weddingId, load]);

  const handleScan = async () => {
    setScanning(true);
    try {
      const r = await api<any>(`/admin/weddings/${weddingId}/photos/scan`, { method: "POST" });
      Alert.alert(
        "✅ Scan terminé",
        `Photos sur disque : ${r.disk_count}\n` +
          `Nouvelles ajoutées : ${r.added}\n` +
          `Vignettes générées : ${r.thumbnails_generated}\n` +
          `Supprimées : ${r.removed}` +
          (r.errors?.length ? `\n\n⚠️ Erreurs : ${r.errors.length}` : "")
      );
      await load();
    } catch (e: any) {
      showAlert("Erreur scan", e.message);
    } finally {
      setScanning(false);
    }
  };

  const handleUploadPhotos = async () => {
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 1,
      });
      if (result.canceled || !result.assets?.length) return;
      setUploadingPhoto(true);
      const token = await getStoredToken();
      let ok = 0, failed = 0;
      for (const asset of result.assets) {
        const form = new FormData();
        if (Platform.OS === "web") {
          // Fetch the blob from URI
          const r = await fetch(asset.uri);
          const blob = await r.blob();
          form.append("file", blob, asset.fileName || `photo_${Date.now()}.jpg`);
        } else {
          form.append("file", {
            uri: asset.uri,
            name: asset.fileName || `photo_${Date.now()}.jpg`,
            type: asset.mimeType || "image/jpeg",
          } as any);
        }
        try {
          const res = await fetch(
            `${BASE_URL}/api/admin/weddings/${weddingId}/photos/upload`,
            {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
              body: form,
            }
          );
          if (res.ok) ok++;
          else failed++;
        } catch {
          failed++;
        }
      }
      Alert.alert(
        "Upload terminé",
        `✅ ${ok} photo${ok > 1 ? "s" : ""} ajoutée${ok > 1 ? "s" : ""}` +
          (failed > 0 ? `\n❌ ${failed} échec${failed > 1 ? "s" : ""}` : "")
      );
      await load();
    } catch (e: any) {
      showAlert("Erreur", e.message);
    } finally {
      setUploadingPhoto(false);
    }
  };

  const handleUploadMusic = async () => {
    try {
      // expo-document-picker would be cleaner but we use ImagePicker for simplicity
      // For now, redirect to web upload
      if (Platform.OS === "web") {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = "audio/*";
        input.onchange = async () => {
          const file = (input.files || [])[0];
          if (!file) return;
          setUploadingMusic(true);
          try {
            const token = await getStoredToken();
            const form = new FormData();
            form.append("file", file);
            const res = await fetch(
              `${BASE_URL}/api/admin/weddings/${weddingId}/music`,
              {
                method: "POST",
                headers: { Authorization: `Bearer ${token}` },
                body: form,
              }
            );
            if (!res.ok) throw new Error("Upload échoué");
            Alert.alert("✅ Musique uploadée", `Taille : ${formatBytes(file.size)}`);
            await load();
          } catch (e: any) {
            showAlert("Erreur", e.message);
          } finally {
            setUploadingMusic(false);
          }
        };
        input.click();
      } else {
        showAlert(
          "À faire sur ordinateur",
          "L'upload de musique se fait depuis cinemaries.fr (admin web)."
        );
      }
    } catch (e: any) {
      showAlert("Erreur", e.message);
    }
  };

  const handleDeleteAll = () => {
    Alert.alert(
      "⚠️ Tout supprimer",
      "Supprimer TOUTES les photos de ce mariage ? Cette action est irréversible.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Tout supprimer",
          style: "destructive",
          onPress: async () => {
            try {
              await api(`/admin/weddings/${weddingId}/photos`, { method: "DELETE" });
              await load();
            } catch (e: any) {
              showAlert("Erreur", e.message);
            }
          },
        },
      ]
    );
  };

  const handleDeleteMusic = async () => {
    try {
      await api(`/admin/weddings/${weddingId}/music`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      showAlert("Erreur", e.message);
    }
  };

  const handleDeletePhoto = (photoId: string) => {
    Alert.alert("Supprimer cette photo ?", "Action irréversible.", [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/admin/weddings/${weddingId}/photos/${photoId}`, { method: "DELETE" });
            await load();
          } catch (e: any) {
            showAlert("Erreur", e.message);
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <SafeAreaView style={s.root} edges={["top"]}>
        <View style={s.center}>
          <ActivityIndicator color={colors.gold} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Galerie photo</Text>
        <View style={{ width: 28 }} />
      </View>

      <ScrollView>
        {/* Stats card */}
        <View style={s.statsCard}>
          <View style={s.statsRow}>
            <Stat label="Photos en DB" value={stats?.photos_count ?? 0} />
            <Stat label="Fichiers disque" value={stats?.disk_files_count ?? 0} />
            <Stat label="Stockage" value={formatBytes(stats?.storage_bytes ?? 0)} />
          </View>
          {stats?.needs_scan && (
            <View style={s.warnBox}>
              <Ionicons name="warning" size={16} color={colors.gold} />
              <Text style={s.warnText}>
                Le disque contient des fichiers non indexés. Lancez un scan.
              </Text>
            </View>
          )}
          <Text style={s.pathText} numberOfLines={1}>
            📂 {stats?.originals_path}
          </Text>
        </View>

        {/* Actions */}
        <View style={s.actions}>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={handleScan}
            disabled={scanning}
          >
            {scanning ? (
              <ActivityIndicator color={colors.gold} />
            ) : (
              <Ionicons name="scan" size={22} color={colors.gold} />
            )}
            <Text style={s.actionText}>Scanner SFTP</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={handleUploadPhotos}
            disabled={uploadingPhoto}
          >
            {uploadingPhoto ? (
              <ActivityIndicator color={colors.gold} />
            ) : (
              <Ionicons name="cloud-upload" size={22} color={colors.gold} />
            )}
            <Text style={s.actionText}>Ajouter photos</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={handleUploadMusic}
            disabled={uploadingMusic}
          >
            {uploadingMusic ? (
              <ActivityIndicator color={colors.gold} />
            ) : (
              <Ionicons name="musical-notes" size={22} color={colors.gold} />
            )}
            <Text style={s.actionText}>
              {stats?.music_filename ? "Remplacer musique" : "Ajouter musique"}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Music info */}
        {stats?.music_filename && (
          <View style={s.musicBox}>
            <Ionicons name="musical-note" size={20} color={colors.gold} />
            <Text style={s.musicTxt}>
              {stats.music_filename} · {formatBytes(stats.music_size)}
            </Text>
            <TouchableOpacity onPress={handleDeleteMusic}>
              <Ionicons name="trash" size={18} color={colors.error} />
            </TouchableOpacity>
          </View>
        )}

        {/* Photos grid */}
        {photos.length > 0 ? (
          <FlatList
            data={photos}
            scrollEnabled={false}
            keyExtractor={(item) => item.id}
            numColumns={3}
            contentContainerStyle={{ padding: spacing.sm }}
            columnWrapperStyle={{ gap: spacing.sm, marginBottom: spacing.sm }}
            renderItem={({ item }) => (
              <TouchableOpacity
                onLongPress={() => handleDeletePhoto(item.id)}
                style={s.cell}
              >
                <Image
                  source={{ uri: `${BASE_URL}${item.thumb_url}` }}
                  style={s.thumb}
                  contentFit="cover"
                />
              </TouchableOpacity>
            )}
          />
        ) : (
          <View style={s.emptyBox}>
            <Ionicons name="images-outline" size={48} color={colors.textDisabled} />
            <Text style={s.emptyText}>Aucune photo</Text>
            <Text style={s.emptyHint}>
              Uploadez via SFTP dans{"\n"}
              <Text style={{ color: colors.gold }}>{stats?.originals_path}</Text>
              {"\n"}puis cliquez « Scanner SFTP »
            </Text>
          </View>
        )}

        {photos.length > 0 && (
          <TouchableOpacity style={s.dangerBtn} onPress={handleDeleteAll}>
            <Ionicons name="trash" size={18} color={colors.error} />
            <Text style={s.dangerTxt}>Tout supprimer</Text>
          </TouchableOpacity>
        )}

        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

async function getStoredToken(): Promise<string> {
  // Read from storage utility — same key as src/api/client.ts
  const { storage } = await import("@/src/utils/storage");
  return (await storage.secureGet<string>(TOKEN_KEY_NAME, "")) || "";
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <View style={s.statItem}>
      <Text style={s.statValue}>{value}</Text>
      <Text style={s.statLabel}>{label}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.ivory, fontSize: 17, fontWeight: "700" },
  statsCard: {
    margin: spacing.md, padding: spacing.md, borderRadius: radii.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
  },
  statsRow: { flexDirection: "row", justifyContent: "space-around" },
  statItem: { alignItems: "center" },
  statValue: { color: colors.gold, fontSize: 22, fontWeight: "700" },
  statLabel: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  warnBox: {
    marginTop: spacing.md, flexDirection: "row", alignItems: "center", gap: 8,
    padding: spacing.sm, backgroundColor: "rgba(212,175,55,0.1)", borderRadius: 6,
  },
  warnText: { color: colors.gold, fontSize: 12, flex: 1 },
  pathText: {
    color: colors.textDisabled, fontSize: 10, marginTop: spacing.sm,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace" }),
  },
  actions: {
    flexDirection: "row", paddingHorizontal: spacing.md, gap: spacing.sm,
  },
  actionBtn: {
    flex: 1, padding: spacing.md, borderRadius: radii.sm,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", gap: 6,
  },
  actionText: { color: colors.ivory, fontSize: 11, fontWeight: "600", textAlign: "center" },
  musicBox: {
    margin: spacing.md, flexDirection: "row", alignItems: "center", gap: spacing.sm,
    padding: spacing.md, backgroundColor: colors.surface, borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  musicTxt: { color: colors.ivory, fontSize: 13, flex: 1 },
  cell: {
    width: ITEM_SIZE, height: ITEM_SIZE, borderRadius: radii.sm,
    overflow: "hidden", backgroundColor: colors.surface,
  },
  thumb: { width: "100%", height: "100%" },
  emptyBox: {
    margin: spacing.md, padding: spacing.xl,
    alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: radii.md,
    borderWidth: 1, borderColor: colors.border, borderStyle: "dashed",
  },
  emptyText: { color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  emptyHint: { color: colors.textSecondary, fontSize: 12, textAlign: "center", lineHeight: 18 },
  dangerBtn: {
    margin: spacing.md, padding: spacing.md, borderRadius: radii.sm,
    borderWidth: 1, borderColor: colors.error,
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.sm,
  },
  dangerTxt: { color: colors.error, fontSize: 14, fontWeight: "600" },
});

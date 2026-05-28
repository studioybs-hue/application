/**
 * CINÉMARIÉS — Viewer photo plein écran
 * Swipe horizontal entre photos, pinch zoom, télécharger, favori
 */
import { useEffect, useState, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  Dimensions, Platform, StatusBar, Alert,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import * as FileSystem from "expo-file-system";
import * as MediaLibrary from "expo-media-library";
import { api } from "@/src/api/client";
import { colors, spacing } from "@/src/theme";
import { showAlert } from "@/src/utils/dialog";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

type PhotoOut = {
  id: string;
  wedding_id: string;
  filename: string;
  thumb_url: string;
  full_url: string;
  width?: number;
  height?: number;
  size_bytes?: number;
  order: number;
  is_favorite: boolean;
};

export default function PhotoViewerScreen() {
  const router = useRouter();
  const { clientId, photoId } = useLocalSearchParams<{ clientId: string; photoId: string }>();
  const [photos, setPhotos] = useState<PhotoOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [favBusy, setFavBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const listRef = useRef<FlatList>(null);

  const load = useCallback(async () => {
    try {
      // On charge jusqu'à 100 photos pour le viewer (max possible)
      const data = await api<PhotoOut[]>(`/weddings/${clientId}/photos?page=1&per_page=100`);
      setPhotos(data);
      const idx = data.findIndex((p) => p.id === photoId);
      const finalIdx = idx >= 0 ? idx : 0;
      setCurrentIndex(finalIdx);
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: finalIdx, animated: false });
      }, 50);
    } catch (e: any) {
      showAlert("Erreur", e.message || "Impossible de charger les photos");
    } finally {
      setLoading(false);
    }
  }, [clientId, photoId]);

  useEffect(() => {
    if (clientId) load();
  }, [clientId, load]);

  const current = photos[currentIndex];

  const onMomentumScrollEnd = (e: any) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_W);
    if (idx !== currentIndex) setCurrentIndex(idx);
  };

  // ===== Favoris =====
  const toggleFavorite = async () => {
    if (!current || favBusy) return;
    setFavBusy(true);
    try {
      const r = await api<{ is_favorite: boolean }>(
        `/weddings/${clientId}/photos/${current.id}/favorite`,
        { method: "POST" }
      );
      setPhotos((prev) =>
        prev.map((p) => (p.id === current.id ? { ...p, is_favorite: r.is_favorite } : p))
      );
    } catch (e: any) {
      showAlert("Erreur", e.message);
    } finally {
      setFavBusy(false);
    }
  };

  // ===== Téléchargement =====
  const downloadCurrent = async () => {
    if (!current || downloading) return;
    setDownloading(true);
    try {
      const url = `${BASE_URL}${current.full_url}`;
      if (Platform.OS === "web") {
        window.open(url, "_blank");
        return;
      }
      // Demander permission galerie
      const perm = await MediaLibrary.requestPermissionsAsync();
      if (!perm.granted) {
        showAlert(
          "Autorisation requise",
          "Activez l'accès aux photos dans les réglages pour enregistrer dans votre galerie."
        );
        return;
      }
      // Télécharger en fichier local
      const fileUri = (FileSystem.cacheDirectory || "") + current.filename;
      const dl = await FileSystem.downloadAsync(url, fileUri);
      // Enregistrer dans galerie
      await MediaLibrary.saveToLibraryAsync(dl.uri);
      Alert.alert("✅ Enregistré", "Photo ajoutée à votre galerie.");
    } catch (e: any) {
      showAlert("Erreur", e.message || "Téléchargement échoué");
    } finally {
      setDownloading(false);
    }
  };

  if (loading || !current) {
    return (
      <SafeAreaView style={s.container} edges={["top", "bottom"]}>
        <View style={s.center}>
          <ActivityIndicator color={colors.gold} size="large" />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <View style={s.container}>
      <StatusBar hidden={!controlsVisible} />

      <FlatList
        ref={listRef}
        data={photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialNumToRender={3}
        windowSize={5}
        keyExtractor={(item) => item.id}
        getItemLayout={(_, index) => ({ length: SCREEN_W, offset: SCREEN_W * index, index })}
        onMomentumScrollEnd={onMomentumScrollEnd}
        renderItem={({ item }) => (
          <TouchableOpacity
            activeOpacity={1}
            onPress={() => setControlsVisible((v) => !v)}
            style={{ width: SCREEN_W, height: SCREEN_H }}
          >
            <Image
              source={{ uri: `${BASE_URL}${item.full_url}` }}
              style={{ width: SCREEN_W, height: SCREEN_H }}
              contentFit="contain"
              transition={150}
            />
          </TouchableOpacity>
        )}
      />

      {/* Header overlay */}
      {controlsVisible && (
        <SafeAreaView edges={["top"]} style={s.headerOverlay}>
          <View style={s.headerRow}>
            <TouchableOpacity onPress={() => router.back()} style={s.headerBtn}>
              <Ionicons name="chevron-back" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={s.counter}>
              {currentIndex + 1} / {photos.length}
            </Text>
            <TouchableOpacity onPress={toggleFavorite} style={s.headerBtn} disabled={favBusy}>
              {favBusy ? (
                <ActivityIndicator color={colors.gold} />
              ) : (
                <Ionicons
                  name={current.is_favorite ? "heart" : "heart-outline"}
                  size={28}
                  color={current.is_favorite ? "#FF3B30" : "#fff"}
                />
              )}
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      {/* Bottom actions overlay */}
      {controlsVisible && (
        <SafeAreaView edges={["bottom"]} style={s.footerOverlay}>
          <TouchableOpacity onPress={downloadCurrent} style={s.actionBtn} disabled={downloading}>
            {downloading ? (
              <ActivityIndicator color={colors.gold} />
            ) : (
              <>
                <Ionicons name="download-outline" size={24} color={colors.gold} />
                <Text style={s.actionText}>Télécharger</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={s.actionBtn}
            onPress={() =>
              router.push({
                pathname: "/photos/[clientId]/slideshow",
                params: { clientId: String(clientId), startId: current.id },
              })
            }
          >
            <Ionicons name="play-circle" size={24} color={colors.gold} />
            <Text style={s.actionText}>Diaporama</Text>
          </TouchableOpacity>
        </SafeAreaView>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  headerOverlay: {
    position: "absolute", top: 0, left: 0, right: 0,
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  headerRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.sm, paddingBottom: spacing.sm,
  },
  headerBtn: {
    width: 44, height: 44, alignItems: "center", justifyContent: "center",
  },
  counter: { color: "#fff", fontSize: 15, fontWeight: "600" },
  footerOverlay: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    flexDirection: "row", justifyContent: "space-around",
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingTop: spacing.sm,
  },
  actionBtn: {
    flex: 1, alignItems: "center", justifyContent: "center",
    paddingVertical: spacing.md, gap: 4,
  },
  actionText: { color: "#fff", fontSize: 12, fontWeight: "500" },
});

/**
 * CINÉMARIÉS — Galerie photo (Insta-style grid)
 * Accessible depuis l'écran mariage. Premium requis.
 */
import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator,
  Dimensions, Modal, Alert, Platform,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { useAuth } from "@/src/auth/AuthContext";
import { showAlert } from "@/src/utils/dialog";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const { width: SCREEN_W } = Dimensions.get("window");
const NUM_COLS = 3;
const ITEM_SIZE = (SCREEN_W - spacing.sm * 4) / NUM_COLS;

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

type PhotosInfo = {
  wedding_id: string;
  photos_count: number;
  music_url: string | null;
  storage_bytes: number;
  has_access: boolean;
  access_reason: string | null;
};

export default function PhotosGalleryScreen() {
  const router = useRouter();
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const { user } = useAuth();

  const [info, setInfo] = useState<PhotosInfo | null>(null);
  const [photos, setPhotos] = useState<PhotoOut[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [downloading, setDownloading] = useState(false);

  const PER_PAGE = 50;

  const loadInfo = useCallback(async () => {
    try {
      const i = await api<PhotosInfo>(`/weddings/${clientId}/photos/info`);
      setInfo(i);
      return i;
    } catch (e: any) {
      setInfo(null);
      throw e;
    }
  }, [clientId]);

  const loadPage = useCallback(
    async (pageNum: number, replace = false) => {
      const data = await api<PhotoOut[]>(
        `/weddings/${clientId}/photos?page=${pageNum}&per_page=${PER_PAGE}`
      );
      if (replace) setPhotos(data);
      else setPhotos((prev) => [...prev, ...data]);
      setHasMore(data.length === PER_PAGE);
      setPage(pageNum);
    },
    [clientId]
  );

  const initialLoad = useCallback(async () => {
    setLoading(true);
    try {
      const i = await loadInfo();
      if (i.has_access && i.photos_count > 0) {
        await loadPage(1, true);
      }
    } catch (e: any) {
      // info charged sets has_access=false on 401/402, no need to alert
    } finally {
      setLoading(false);
    }
  }, [loadInfo, loadPage]);

  useEffect(() => {
    if (clientId) initialLoad();
  }, [clientId, initialLoad]);

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadInfo();
      await loadPage(1, true);
    } catch {}
    setRefreshing(false);
  };

  const onEndReached = async () => {
    if (!hasMore || loading) return;
    try {
      await loadPage(page + 1);
    } catch {}
  };

  // ===== Selection =====
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enterSelection = (id: string) => {
    setSelectionMode(true);
    setSelectedIds(new Set([id]));
  };

  const exitSelection = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  // ===== Download =====
  const downloadSelected = async () => {
    if (selectedIds.size === 0) return;
    setDownloading(true);
    try {
      const ids = Array.from(selectedIds).join(",");
      const url = `${BASE_URL}/api/weddings/${clientId}/photos/download?ids=${ids}`;
      await openDownloadUrl(url);
      exitSelection();
    } catch (e: any) {
      showAlert("Erreur", e.message || "Téléchargement échoué");
    } finally {
      setDownloading(false);
    }
  };

  const downloadAll = async () => {
    if (!info || info.photos_count === 0) return;
    setDownloading(true);
    try {
      const url = `${BASE_URL}/api/weddings/${clientId}/photos/download?ids=all`;
      await openDownloadUrl(url);
    } catch (e: any) {
      showAlert("Erreur", e.message || "Téléchargement échoué");
    } finally {
      setDownloading(false);
    }
  };

  const openDownloadUrl = async (url: string) => {
    if (Platform.OS === "web") {
      // Sur web : ouvre le téléchargement directement
      window.open(url, "_blank");
      return;
    }
    // Sur mobile : on délègue au viewer photo individuel pour expo-media-library
    // Pour le ZIP multi, on utilise Linking pour ouvrir dans le navigateur (téléchargement OS)
    const Linking = await import("expo-linking");
    await Linking.openURL(url);
  };

  // ===== Render =====
  if (loading) {
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <Header title="Galerie photo" onBack={() => router.back()} />
        <View style={s.center}>
          <ActivityIndicator color={colors.gold} size="large" />
          <Text style={s.dimText}>Chargement…</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ===== Gate Premium ou No Access =====
  if (info && !info.has_access) {
    const reason = info.access_reason;
    const isCoupleOnly = reason === "couple_only";
    const isUnauth = reason === "not_authenticated";
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <Header title="Galerie photo" onBack={() => router.back()} />
        <View style={s.gateContainer}>
          <Ionicons
            name={isCoupleOnly ? "heart" : "lock-closed"}
            size={64}
            color={colors.gold}
          />
          <Text style={s.gateTitle}>
            {isCoupleOnly ? "Galerie privée" : isUnauth ? "Connexion requise" : "Accès réservé"}
          </Text>
          <Text style={s.gateText}>
            {isCoupleOnly
              ? "Cette galerie photo est réservée aux mariés. Vos invités peuvent voir vos vidéos via le code, mais pas vos photos privées."
              : isUnauth
              ? "Connectez-vous pour accéder à votre galerie photo."
              : "Vous n'avez pas accès à cette galerie."}
          </Text>
          {info.photos_count > 0 && !isCoupleOnly && (
            <Text style={s.gateMeta}>📸 {info.photos_count} photos disponibles</Text>
          )}
          {isUnauth && (
            <TouchableOpacity
              style={s.gateCta}
              onPress={() => router.push("/auth/login")}
            >
              <Ionicons name="log-in" size={18} color="#000" />
              <Text style={s.gateCtaText}>Se connecter</Text>
            </TouchableOpacity>
          )}
        </View>
      </SafeAreaView>
    );
  }

  // ===== Empty state =====
  if (!info || info.photos_count === 0) {
    return (
      <SafeAreaView style={s.container} edges={["top"]}>
        <Header title="Galerie photo" onBack={() => router.back()} />
        <View style={s.center}>
          <Ionicons name="images-outline" size={64} color={colors.textDisabled} />
          <Text style={s.emptyTitle}>Aucune photo disponible</Text>
          <Text style={s.dimText}>
            Les photos de votre mariage apparaîtront ici dès leur mise en ligne par le studio.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.container} edges={["top"]}>
      {/* Header */}
      {selectionMode ? (
        <View style={s.selectionHeader}>
          <TouchableOpacity onPress={exitSelection} style={s.headerBtn}>
            <Ionicons name="close" size={26} color={colors.textPrimary} />
          </TouchableOpacity>
          <Text style={s.selectionCount}>
            {selectedIds.size} sélectionnée{selectedIds.size > 1 ? "s" : ""}
          </Text>
          <TouchableOpacity
            onPress={downloadSelected}
            disabled={selectedIds.size === 0 || downloading}
            style={[s.headerBtn, selectedIds.size === 0 && { opacity: 0.4 }]}
          >
            {downloading ? (
              <ActivityIndicator color={colors.gold} />
            ) : (
              <Ionicons name="download-outline" size={26} color={colors.gold} />
            )}
          </TouchableOpacity>
        </View>
      ) : (
        <Header
          title={`${info.photos_count} photos`}
          onBack={() => router.back()}
          right={
            <TouchableOpacity
              onPress={() =>
                router.push({
                  pathname: "/photos/[clientId]/slideshow",
                  params: { clientId: String(clientId) },
                })
              }
              style={s.headerBtn}
            >
              <Ionicons name="play-circle" size={28} color={colors.gold} />
            </TouchableOpacity>
          }
        />
      )}

      <FlatList
        data={photos}
        keyExtractor={(item) => item.id}
        numColumns={NUM_COLS}
        contentContainerStyle={s.gridContent}
        columnWrapperStyle={s.row}
        refreshing={refreshing}
        onRefresh={onRefresh}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.5}
        renderItem={({ item }) => {
          const selected = selectedIds.has(item.id);
          return (
            <TouchableOpacity
              onPress={() => {
                if (selectionMode) {
                  toggleSelect(item.id);
                } else {
                  router.push({
                    pathname: "/photos/[clientId]/[photoId]",
                    params: { clientId: String(clientId), photoId: item.id },
                  });
                }
              }}
              onLongPress={() => !selectionMode && enterSelection(item.id)}
              activeOpacity={0.7}
              style={[s.cell, selected && s.cellSelected]}
            >
              <Image
                source={{ uri: `${BASE_URL}${item.thumb_url}` }}
                style={s.thumb}
                contentFit="cover"
                transition={200}
              />
              {item.is_favorite && (
                <View style={s.favBadge}>
                  <Ionicons name="heart" size={14} color="#fff" />
                </View>
              )}
              {selectionMode && (
                <View style={[s.checkbox, selected && s.checkboxOn]}>
                  {selected && <Ionicons name="checkmark" size={16} color="#000" />}
                </View>
              )}
            </TouchableOpacity>
          );
        }}
        ListFooterComponent={
          hasMore && photos.length > 0 ? (
            <View style={{ padding: spacing.md }}>
              <ActivityIndicator color={colors.gold} />
            </View>
          ) : null
        }
      />

      {/* FAB Download All */}
      {!selectionMode && (
        <TouchableOpacity
          style={s.fab}
          onPress={() =>
            Alert.alert(
              "Télécharger toutes les photos",
              `Télécharger les ${info.photos_count} photos en archive ZIP ?`,
              [
                { text: "Annuler", style: "cancel" },
                { text: "Télécharger", onPress: downloadAll },
              ]
            )
          }
          disabled={downloading}
        >
          {downloading ? (
            <ActivityIndicator color="#000" />
          ) : (
            <>
              <Ionicons name="download" size={22} color="#000" />
              <Text style={s.fabText}>Tout télécharger</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </SafeAreaView>
  );
}

function Header({
  title,
  onBack,
  right,
}: {
  title: string;
  onBack: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={s.header}>
      <TouchableOpacity onPress={onBack} style={s.headerBtn}>
        <Ionicons name="chevron-back" size={26} color={colors.textPrimary} />
      </TouchableOpacity>
      <Text style={s.headerTitle} numberOfLines={1}>
        {title}
      </Text>
      <View style={{ width: 40, alignItems: "flex-end" }}>{right}</View>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg, gap: spacing.md },
  dimText: { color: colors.textSecondary, textAlign: "center", marginTop: spacing.sm },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerBtn: {
    width: 40, height: 40, alignItems: "center", justifyContent: "center",
  },
  headerTitle: {
    flex: 1, color: colors.textPrimary, fontSize: 17, fontWeight: "600", textAlign: "center",
  },
  selectionHeader: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.sm, paddingVertical: spacing.sm,
    backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  selectionCount: { color: colors.gold, fontSize: 16, fontWeight: "600" },
  gridContent: { padding: spacing.sm, paddingBottom: 100 },
  row: { gap: spacing.sm, marginBottom: spacing.sm },
  cell: {
    width: ITEM_SIZE, height: ITEM_SIZE, borderRadius: radii.sm,
    overflow: "hidden", backgroundColor: colors.surface,
  },
  cellSelected: { borderWidth: 3, borderColor: colors.gold },
  thumb: { width: "100%", height: "100%" },
  favBadge: {
    position: "absolute", bottom: 6, right: 6,
    backgroundColor: "rgba(0,0,0,0.6)", borderRadius: 10, padding: 4,
  },
  checkbox: {
    position: "absolute", top: 6, right: 6,
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: "rgba(0,0,0,0.5)", borderWidth: 2, borderColor: "#fff",
    alignItems: "center", justifyContent: "center",
  },
  checkboxOn: { backgroundColor: colors.gold, borderColor: colors.gold },
  fab: {
    position: "absolute", bottom: spacing.lg, alignSelf: "center",
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    backgroundColor: colors.gold, paddingHorizontal: spacing.lg, paddingVertical: spacing.md,
    borderRadius: 999, shadowColor: "#000", shadowOpacity: 0.3, shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 }, elevation: 5,
  },
  fabText: { color: "#000", fontSize: 15, fontWeight: "700" },
  gateContainer: {
    flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md,
  },
  gateTitle: { color: colors.gold, fontSize: 24, fontWeight: "700", marginTop: spacing.md },
  gateText: {
    color: colors.textSecondary, textAlign: "center", fontSize: 15, lineHeight: 22,
    paddingHorizontal: spacing.md,
  },
  gateMeta: { color: colors.textPrimary, fontSize: 16, fontWeight: "600", marginTop: spacing.sm },
  gateCta: {
    marginTop: spacing.lg, backgroundColor: colors.gold,
    flexDirection: "row", alignItems: "center", gap: spacing.sm,
    paddingHorizontal: spacing.xl, paddingVertical: spacing.md, borderRadius: 999,
  },
  gateCtaText: { color: "#000", fontSize: 16, fontWeight: "700" },
  emptyTitle: { color: colors.textPrimary, fontSize: 18, fontWeight: "600", marginTop: spacing.sm },
});

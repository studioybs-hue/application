/**
 * Admin Wedding Covers — list all weddings with their current cover and quick edit access.
 */
import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

type W = {
  client_id: string;
  client_name: string;
  poster_url: string;
  hero_url: string;
  video_count: number;
  has_custom_cover?: boolean;
};

export default function AdminWeddingCovers() {
  const router = useRouter();
  const [items, setItems] = useState<W[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ featured: W[]; weddings: W[] }>("/weddings/public");
      // For each wedding, check if it has a custom cover
      const enriched: W[] = [];
      for (const w of r.weddings) {
        try {
          const meta = await api<{ poster_url: string; hero_url: string }>(`/admin/weddings/${w.client_id}/cover`);
          enriched.push({ ...w, has_custom_cover: !!(meta.poster_url || meta.hero_url) });
        } catch {
          enriched.push({ ...w, has_custom_cover: false });
        }
      }
      setItems(enriched);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={styles.title}>Couvertures des mariages</Text>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.banner}>
        <Ionicons name="information-circle" size={18} color={colors.gold} />
        <Text style={styles.bannerTxt}>
          Définissez une couverture <Text style={{ color: colors.gold, fontWeight: "700" }}>dédiée</Text> à chaque mariage. Elle remplace l&apos;image de la 1ère vidéo dans le catalogue.
        </Text>
      </View>

      <FlatList
        data={items}
        keyExtractor={(w) => w.client_id}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 80 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => { setRefreshing(true); load(); }}
            tintColor={colors.gold}
          />
        }
        renderItem={({ item: w }) => {
          const poster = w.poster_url ? (w.poster_url.startsWith("http") ? w.poster_url : `${BASE}${w.poster_url}`) : "";
          return (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.85}
              onPress={() => router.push(`/admin/wedding-cover/${w.client_id}`)}
              testID={`cover-row-${w.client_id}`}
            >
              {poster ? (
                <Image source={{ uri: poster }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <Ionicons name="image-outline" size={24} color={colors.textSecondary} />
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.cardTitle} numberOfLines={1}>{w.client_name}</Text>
                <Text style={styles.cardMeta}>
                  {w.video_count} vidéo{w.video_count > 1 ? "s" : ""}
                </Text>
                <View style={styles.badgeRow}>
                  {w.has_custom_cover ? (
                    <View style={[styles.badge, { backgroundColor: "rgba(31,122,58,0.2)", borderColor: "#1f7a3a" }]}>
                      <Ionicons name="checkmark-circle" size={12} color="#3ada6a" />
                      <Text style={[styles.badgeTxt, { color: "#3ada6a" }]}>Personnalisée</Text>
                    </View>
                  ) : (
                    <View style={[styles.badge, { backgroundColor: "rgba(255,255,255,0.05)", borderColor: "rgba(255,255,255,0.15)" }]}>
                      <Ionicons name="film-outline" size={12} color={colors.textSecondary} />
                      <Text style={[styles.badgeTxt, { color: colors.textSecondary }]}>Auto (1ère vidéo)</Text>
                    </View>
                  )}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
            </TouchableOpacity>
          );
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            <Ionicons name="film-outline" size={48} color={colors.textSecondary} />
            <Text style={styles.emptyTxt}>Aucun mariage trouvé</Text>
          </View>
        }
      />
    </SafeAreaView>
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
  banner: {
    flexDirection: "row",
    alignItems: "center",
    margin: spacing.md,
    padding: 10,
    backgroundColor: "rgba(212,175,55,0.08)",
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    borderRadius: radii.sm,
  },
  bannerTxt: { color: colors.ivory, fontSize: 12, marginLeft: 8, flex: 1, lineHeight: 16 },
  card: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: 12,
    borderRadius: radii.md,
    marginBottom: 10,
  },
  thumb: { width: 60, height: 80, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.05)" },
  thumbEmpty: { alignItems: "center", justifyContent: "center" },
  cardTitle: { color: colors.ivory, fontSize: 15, fontWeight: "700" },
  cardMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  badgeRow: { flexDirection: "row", marginTop: 8 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    borderWidth: 1,
    gap: 4,
  },
  badgeTxt: { fontSize: 10, fontWeight: "700", letterSpacing: 0.3 },
  empty: { alignItems: "center", paddingVertical: 60 },
  emptyTxt: { color: colors.textSecondary, fontSize: 14, marginTop: 12 },
});

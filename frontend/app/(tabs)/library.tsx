import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { useAuth } from "@/src/auth/AuthContext";

type Video = {
  id: string;
  title: string;
  description: string;
  poster_url: string;
  duration_minutes: number;
};

export default function LibraryScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    try {
      const d = await api<{ videos: Video[] }>("/library");
      setVideos(d.videos);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    if (!authLoading) load();
  }, [authLoading, load]);

  if (!user) {
    return (
      <SafeAreaView style={styles.empty} testID="library-locked">
        <Ionicons name="lock-closed" size={56} color={colors.gold} />
        <Text style={styles.emptyTitle}>Connectez-vous</Text>
        <Text style={styles.emptySub}>
          Connectez-vous pour accéder à vos vidéos privées débloquées.
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.push("/auth/login")}
          testID="library-login-btn"
        >
          <Text style={styles.primaryTxt}>Se connecter</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Ma Bibliothèque</Text>
        <TouchableOpacity
          style={styles.unlockBtn}
          onPress={() => router.push("/unlock")}
          testID="library-unlock-btn"
        >
          <Ionicons name="key-outline" size={16} color={colors.gold} />
          <Text style={styles.unlockTxt}>Code</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              load();
            }}
            tintColor={colors.gold}
          />
        }
      >
        {videos.length === 0 ? (
          <View style={styles.emptyState} testID="library-empty">
            <Ionicons name="film-outline" size={56} color={colors.textDisabled} />
            <Text style={styles.emptyTitle}>Aucune vidéo débloquée</Text>
            <Text style={styles.emptySub}>
              Entrez votre code client unique pour accéder à vos films de mariage.
            </Text>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => router.push("/unlock")}
              testID="library-add-code-btn"
            >
              <Ionicons name="key" size={16} color="#0A0A0A" />
              <Text style={styles.primaryTxt}>Entrer un code</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.grid}>
            {videos.map((v) => (
              <TouchableOpacity
                key={v.id}
                style={styles.gridItem}
                activeOpacity={0.85}
                onPress={() => router.push(`/video/${v.id}`)}
                testID={`library-item-${v.id}`}
              >
                <Image source={{ uri: v.poster_url }} style={styles.poster} contentFit="cover" />
                <View style={styles.unlockedBadge}>
                  <Ionicons name="checkmark-circle" size={14} color={colors.gold} />
                  <Text style={styles.unlockedTxt}>Débloqué</Text>
                </View>
                <Text style={styles.itemTitle} numberOfLines={1}>
                  {v.title}
                </Text>
                <Text style={styles.itemMeta}>{v.duration_minutes} min</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  title: { color: colors.ivory, fontSize: 26, fontWeight: "700" },
  unlockBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unlockTxt: { color: colors.gold, fontWeight: "600", fontSize: 13 },
  grid: { flexDirection: "row", flexWrap: "wrap", justifyContent: "space-between" },
  gridItem: { width: "48%", marginBottom: spacing.md },
  poster: { width: "100%", aspectRatio: 2 / 3, borderRadius: radii.sm, backgroundColor: colors.surfaceElevated },
  unlockedBadge: {
    position: "absolute",
    top: 8,
    right: 8,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  unlockedTxt: { color: colors.gold, fontSize: 10, fontWeight: "700" },
  itemTitle: { color: colors.ivory, fontWeight: "600", marginTop: 8, fontSize: 14 },
  itemMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  empty: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  emptyState: { alignItems: "center", padding: spacing.lg, marginTop: spacing.xl },
  emptyTitle: { color: colors.ivory, fontSize: 20, fontWeight: "700", marginTop: spacing.md },
  emptySub: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    marginTop: 8,
    marginBottom: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  primaryBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.gold,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: radii.sm,
  },
  primaryTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 14 },
});

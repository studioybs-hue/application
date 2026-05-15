import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";

type V = {
  id: string;
  title: string;
  category: string;
  poster_url: string;
  duration_minutes: number;
  is_top_france?: boolean;
  is_featured?: boolean;
};

export default function AdminVideosList() {
  const router = useRouter();
  const [videos, setVideos] = useState<V[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ videos: V[] }>("/admin/videos");
      setVideos(r.videos);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const onDelete = (v: V) => {
    Alert.alert("Supprimer la vidéo ?", `« ${v.title} » sera définitivement supprimée.`, [
      { text: "Annuler", style: "cancel" },
      {
        text: "Supprimer",
        style: "destructive",
        onPress: async () => {
          try {
            await api(`/admin/videos/${v.id}`, { method: "DELETE" });
            setVideos((prev) => prev.filter((x) => x.id !== v.id));
          } catch (e: any) {
            Alert.alert("Erreur", e.message);
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="admin-videos-back">
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={styles.title}>Vidéos</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={() => router.push("/admin/video-edit/new")}
          testID="admin-add-video-btn"
        >
          <Ionicons name="add" size={22} color="#0A0A0A" />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.gold} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />
          }
        >
          {videos.length === 0 ? (
            <Text style={styles.empty}>Aucune vidéo. Cliquez sur + pour en ajouter.</Text>
          ) : (
            videos.map((v) => (
              <View key={v.id} style={styles.row} testID={`admin-video-${v.id}`}>
                <Image source={{ uri: v.poster_url }} style={styles.poster} contentFit="cover" />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle} numberOfLines={1}>{v.title}</Text>
                  <Text style={styles.rowMeta}>{v.category} · {v.duration_minutes} min</Text>
                  <View style={styles.badges}>
                    {v.is_top_france && <View style={[styles.badge, { backgroundColor: colors.wine }]}><Text style={styles.badgeTxt}>N°1</Text></View>}
                    {v.is_featured && <View style={[styles.badge, { backgroundColor: colors.gold }]}><Text style={[styles.badgeTxt, { color: "#0A0A0A" }]}>Featured</Text></View>}
                  </View>
                </View>
                <View style={styles.rowActions}>
                  <TouchableOpacity onPress={() => router.push(`/admin/video-edit/${v.id}`)} style={styles.iconBtn} testID={`edit-${v.id}`}>
                    <Ionicons name="create-outline" size={20} color={colors.gold} />
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => onDelete(v)} style={styles.iconBtn} testID={`delete-${v.id}`}>
                    <Ionicons name="trash-outline" size={20} color={colors.error} />
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.md },
  title: { flex: 1, color: colors.ivory, fontSize: 22, fontWeight: "700" },
  addBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.sm,
    marginBottom: spacing.sm,
    gap: spacing.md,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  poster: { width: 48, height: 72, borderRadius: 4 },
  rowTitle: { color: colors.ivory, fontSize: 15, fontWeight: "600" },
  rowMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  badges: { flexDirection: "row", gap: 6, marginTop: 6 },
  badge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 },
  badgeTxt: { color: colors.ivory, fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  rowActions: { flexDirection: "row", gap: 4 },
  iconBtn: { width: 38, height: 38, alignItems: "center", justifyContent: "center" },
  empty: { color: colors.textSecondary, fontStyle: "italic", textAlign: "center", padding: spacing.lg },
});

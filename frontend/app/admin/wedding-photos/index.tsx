/**
 * Admin — Liste des mariages pour gérer leurs galeries photo
 */
import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, TextInput,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert } from "@/src/utils/dialog";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";

type Wedding = {
  client_id: string;
  client_name: string;
  video_count: number;
  poster_url?: string;
  created_at?: string;
};

export default function AdminWeddingPhotosListScreen() {
  const router = useRouter();
  const [weddings, setWeddings] = useState<Wedding[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<{ weddings: Wedding[] }>("/admin/weddings");
      setWeddings(r.weddings || []);
    } catch (e: any) {
      showAlert("Erreur", e.message);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = weddings.filter((w) =>
    !filter ||
    w.client_name.toLowerCase().includes(filter.toLowerCase()) ||
    w.client_id.toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <SafeAreaView style={s.root} edges={["top"]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={28} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Galeries photos</Text>
        <View style={{ width: 28 }} />
      </View>

      <TextInput
        style={s.search}
        placeholder="Rechercher un mariage…"
        placeholderTextColor={colors.textDisabled}
        value={filter}
        onChangeText={setFilter}
      />

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color={colors.gold} size="large" />
        </View>
      ) : (
        <ScrollView
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
          {filtered.length === 0 ? (
            <Text style={s.empty}>Aucun mariage trouvé.</Text>
          ) : (
            filtered.map((w) => (
              <TouchableOpacity
                key={w.client_id}
                style={s.row}
                onPress={() =>
                  router.push({
                    pathname: "/admin/wedding-photos/[weddingId]",
                    params: { weddingId: w.client_id },
                  })
                }
              >
                {w.poster_url ? (
                  <Image
                    source={{ uri: w.poster_url.startsWith("http") ? w.poster_url : `${BASE_URL}${w.poster_url}` }}
                    style={s.poster}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[s.poster, { alignItems: "center", justifyContent: "center" }]}>
                    <Ionicons name="heart" size={20} color={colors.gold} />
                  </View>
                )}
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={s.name} numberOfLines={1}>{w.client_name}</Text>
                  <Text style={s.meta}>
                    {w.video_count} vidéo{w.video_count > 1 ? "s" : ""} · {w.client_id.substring(0, 8)}…
                  </Text>
                </View>
                <Ionicons name="images" size={22} color={colors.gold} />
              </TouchableOpacity>
            ))
          )}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}
    </SafeAreaView>
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
  search: {
    margin: spacing.md, padding: spacing.md, borderRadius: radii.sm,
    backgroundColor: colors.surface, color: colors.ivory,
    borderWidth: 1, borderColor: colors.border, fontSize: 14,
  },
  row: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: spacing.sm, paddingHorizontal: spacing.md,
    borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  poster: {
    width: 50, height: 50, borderRadius: radii.sm,
    backgroundColor: colors.surface,
  },
  name: { color: colors.ivory, fontWeight: "600", fontSize: 15 },
  meta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  empty: { color: colors.textSecondary, textAlign: "center", padding: spacing.xl, fontStyle: "italic" },
});

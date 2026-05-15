import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";

type U = {
  id: string;
  email: string;
  full_name: string;
  is_subscribed: boolean;
  is_admin: boolean;
  unlocks: number;
  created_at: string | null;
};

export default function AdminUsers() {
  const router = useRouter();
  const [users, setUsers] = useState<U[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ users: U[] }>("/admin/users");
      setUsers(r.users);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="users-back">
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={styles.title}>Utilisateurs ({users.length})</Text>
        <View style={{ width: 26 }} />
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
          {users.map((u) => (
            <View key={u.id} style={styles.row} testID={`user-${u.id}`}>
              <View style={[styles.avatar, u.is_admin && { borderColor: colors.wine }]}>
                <Text style={styles.avatarTxt}>{(u.full_name || u.email).slice(0, 1).toUpperCase()}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Text style={styles.name} numberOfLines={1}>{u.full_name || "—"}</Text>
                  {u.is_admin && <View style={[styles.tag, { backgroundColor: colors.wine }]}><Text style={styles.tagTxt}>ADMIN</Text></View>}
                  {u.is_subscribed && <View style={[styles.tag, { backgroundColor: colors.gold }]}><Text style={[styles.tagTxt, { color: "#0A0A0A" }]}>PREMIUM</Text></View>}
                </View>
                <Text style={styles.email} numberOfLines={1}>{u.email}</Text>
                <Text style={styles.meta}>
                  {u.unlocks} vidéo{u.unlocks !== 1 ? "s" : ""} débloquée{u.unlocks !== 1 ? "s" : ""}
                  {u.created_at ? `  ·  ${new Date(u.created_at).toLocaleDateString("fr-FR")}` : ""}
                </Text>
              </View>
            </View>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.md },
  title: { flex: 1, color: colors.ivory, fontSize: 20, fontWeight: "700" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.md, marginBottom: 8 },
  avatar: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  avatarTxt: { color: colors.gold, fontSize: 20, fontWeight: "700" },
  name: { color: colors.ivory, fontSize: 15, fontWeight: "600" },
  email: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  meta: { color: colors.textDisabled, fontSize: 11, marginTop: 4 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 },
  tagTxt: { color: colors.ivory, fontSize: 9, fontWeight: "700", letterSpacing: 1 },
});

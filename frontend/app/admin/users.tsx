import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Modal, Platform, KeyboardAvoidingView,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert } from "@/src/utils/dialog";

type U = {
  id: string;
  email: string;
  full_name: string;
  is_subscribed: boolean;
  is_admin: boolean;
  subscription_tier?: string | null;
  client_id?: string | null;
  unlocks: number;
  created_at: string | null;
};

type Wedding = { client_id: string; client_name: string };

export default function AdminUsers() {
  const router = useRouter();
  const [users, setUsers] = useState<U[]>([]);
  const [weddings, setWeddings] = useState<Wedding[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [assignTarget, setAssignTarget] = useState<U | null>(null);
  const [assigning, setAssigning] = useState(false);

  const load = useCallback(async () => {
    try {
      const [r, v] = await Promise.all([
        api<{ users: U[] }>("/admin/users"),
        api<{ videos: any[] }>("/admin/videos"),
      ]);
      setUsers(r.users);
      // Build weddings list
      const map = new Map<string, Wedding>();
      for (const vid of v.videos || []) {
        const cid = vid.client_id || vid.title?.toLowerCase().replace(/\s+/g, "-");
        const name = vid.client_name || vid.title;
        if (cid && !map.has(cid)) {
          map.set(cid, { client_id: cid, client_name: name });
        }
      }
      setWeddings(Array.from(map.values()).sort((a, b) => a.client_name.localeCompare(b.client_name)));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const assignWedding = async (clientId: string) => {
    if (!assignTarget) return;
    setAssigning(true);
    try {
      const r = await api<{ client_name: string }>(`/admin/users/${assignTarget.id}/assign-wedding`, {
        method: "POST",
        body: { client_id: clientId },
      });
      setAssignTarget(null);
      await load();
      showAlert("✓ Assigné", `Mariage « ${r.client_name} » assigné à ${assignTarget.email}.`);
    } catch (e: any) {
      showAlert("Erreur", e.message);
    } finally {
      setAssigning(false);
    }
  };

  const unassignWedding = async (u: U) => {
    try {
      await api(`/admin/users/${u.id}/wedding`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      showAlert("Erreur", e.message);
    }
  };

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
          {users.map((u) => {
            const weddingName = u.client_id ? weddings.find((w) => w.client_id === u.client_id)?.client_name : null;
            return (
              <View key={u.id} style={styles.row} testID={`user-${u.id}`}>
                <View style={[styles.avatar, u.is_admin && { borderColor: colors.wine }]}>
                  <Text style={styles.avatarTxt}>{(u.full_name || u.email).slice(0, 1).toUpperCase()}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <Text style={styles.name} numberOfLines={1}>{u.full_name || "—"}</Text>
                    {u.is_admin && <View style={[styles.tag, { backgroundColor: colors.wine }]}><Text style={styles.tagTxt}>ADMIN</Text></View>}
                    {u.is_subscribed && (
                      <View style={[styles.tag, { backgroundColor: colors.gold }]}>
                        <Text style={[styles.tagTxt, { color: "#0A0A0A" }]}>
                          {u.subscription_tier === "unlimited" ? "PREMIUM ∞" : "PREMIUM"}
                        </Text>
                      </View>
                    )}
                  </View>
                  <Text style={styles.email} numberOfLines={1}>{u.email}</Text>
                  {weddingName ? (
                    <View style={styles.weddingChip}>
                      <Ionicons name="heart" size={11} color={colors.gold} />
                      <Text style={styles.weddingChipTxt}>{weddingName}</Text>
                      <TouchableOpacity onPress={() => unassignWedding(u)} hitSlop={8}>
                        <Ionicons name="close-circle" size={14} color={colors.textSecondary} />
                      </TouchableOpacity>
                    </View>
                  ) : null}
                  <Text style={styles.meta}>
                    {u.unlocks} vidéo{u.unlocks !== 1 ? "s" : ""} débloquée{u.unlocks !== 1 ? "s" : ""}
                    {u.created_at ? `  ·  ${new Date(u.created_at).toLocaleDateString("fr-FR")}` : ""}
                  </Text>
                </View>
                {!u.is_admin && (
                  <TouchableOpacity
                    style={styles.assignBtn}
                    onPress={() => setAssignTarget(u)}
                    testID={`assign-${u.id}`}
                  >
                    <Ionicons name="link" size={14} color={colors.gold} />
                    <Text style={styles.assignTxt}>{u.client_id ? "Changer" : "Assigner"}</Text>
                  </TouchableOpacity>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {/* Assign wedding modal */}
      <Modal visible={!!assignTarget} animationType="slide" transparent onRequestClose={() => setAssignTarget(null)}>
        <KeyboardAvoidingView
          style={styles.modalBg}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
        >
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modalTitle}>Assigner un mariage</Text>
                <Text style={styles.modalSub}>{assignTarget?.email}</Text>
              </View>
              <TouchableOpacity onPress={() => setAssignTarget(null)} disabled={assigning}>
                <Ionicons name="close" size={26} color={colors.ivory} />
              </TouchableOpacity>
            </View>

            <Text style={styles.helper}>Le client pourra alors générer ses propres codes d'invitation depuis la page de son mariage.</Text>

            <ScrollView style={{ maxHeight: 400 }}>
              {weddings.length === 0 ? (
                <Text style={styles.empty}>Aucun mariage disponible.</Text>
              ) : (
                weddings.map((w) => {
                  const active = w.client_id === assignTarget?.client_id;
                  return (
                    <TouchableOpacity
                      key={w.client_id}
                      style={[styles.weddingItem, active && styles.weddingItemActive]}
                      onPress={() => assignWedding(w.client_id)}
                      disabled={assigning}
                    >
                      <Ionicons name={active ? "checkmark-circle" : "heart-outline"} size={20} color={active ? colors.gold : colors.textSecondary} />
                      <Text style={[styles.weddingItemTxt, active && { color: colors.gold, fontWeight: "700" }]}>{w.client_name}</Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>

            {assigning && <ActivityIndicator color={colors.gold} style={{ marginTop: 12 }} />}
          </View>
        </KeyboardAvoidingView>
      </Modal>
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
  weddingChip: { flexDirection: "row", alignSelf: "flex-start", alignItems: "center", gap: 4, backgroundColor: "rgba(212,175,55,0.12)", borderWidth: 1, borderColor: colors.gold, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, marginTop: 6 },
  weddingChipTxt: { color: colors.gold, fontSize: 11, fontWeight: "600" },
  assignBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.gold, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  assignTxt: { color: colors.gold, fontSize: 11, fontWeight: "700" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modal: { backgroundColor: colors.surfaceElevated, padding: spacing.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: spacing.xl, borderTopWidth: 1, borderColor: colors.gold, maxHeight: "85%" },
  modalHeader: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  modalTitle: { color: colors.ivory, fontSize: 22, fontWeight: "700" },
  modalSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  helper: { color: colors.textSecondary, fontSize: 12, lineHeight: 18, marginBottom: spacing.md },
  empty: { color: colors.textSecondary, fontStyle: "italic", textAlign: "center", paddingVertical: spacing.md },
  weddingItem: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, borderWidth: 1, borderColor: colors.border, borderRadius: 8, marginBottom: 8, backgroundColor: colors.bg },
  weddingItemActive: { borderColor: colors.gold, backgroundColor: "rgba(212,175,55,0.08)" },
  weddingItemTxt: { color: colors.ivory, fontSize: 14 },
});

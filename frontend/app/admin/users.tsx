import { useEffect, useState, useCallback, useMemo } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator,
  RefreshControl, Modal, Platform, KeyboardAvoidingView, TextInput, Switch, Linking,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert, showConfirm } from "@/src/utils/dialog";
import { useAuth } from "@/src/auth/AuthContext";

type U = {
  id: string;
  email: string;
  full_name: string;
  is_subscribed: boolean;
  is_admin: boolean;
  is_active: boolean;
  subscription_tier?: string | null;
  client_id?: string | null;
  unlocks: number;
  created_at: string | null;
  last_login_at: string | null;
  days_inactive: number | null;
};

type Wedding = { client_id: string; client_name: string };
type FilterMode = "all" | "active" | "inactive" | "never";

export default function AdminUsers() {
  const router = useRouter();
  const { user: me } = useAuth();
  const [users, setUsers] = useState<U[]>([]);
  const [weddings, setWeddings] = useState<Wedding[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<FilterMode>("all");
  const [editTarget, setEditTarget] = useState<U | null>(null);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editFields, setEditFields] = useState<Partial<U>>({});

  const load = useCallback(async () => {
    try {
      const [r, v] = await Promise.all([
        api<{ users: U[] }>("/admin/users"),
        api<{ videos: any[] }>("/admin/videos"),
      ]);
      setUsers(r.users);
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

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return users.filter((u) => {
      // search
      if (s && !u.email.toLowerCase().includes(s) && !(u.full_name || "").toLowerCase().includes(s)) return false;
      // filter mode
      if (filter === "never" && u.last_login_at) return false;
      if (filter === "active" && (!u.last_login_at || (u.days_inactive ?? 99999) > 90)) return false;
      if (filter === "inactive" && (!u.last_login_at || (u.days_inactive ?? 0) <= 90)) return false;
      return true;
    });
  }, [users, search, filter]);

  const openEdit = (u: U) => {
    setEditTarget(u);
    setEditFields({
      email: u.email,
      full_name: u.full_name || "",
      is_admin: u.is_admin,
      is_subscribed: u.is_subscribed,
      is_active: u.is_active,
      subscription_tier: u.subscription_tier || null,
      client_id: u.client_id || null,
    });
  };

  const saveEdit = async () => {
    if (!editTarget) return;
    setSavingEdit(true);
    try {
      // Only send changed fields
      const payload: any = {};
      if (editFields.email !== editTarget.email) payload.email = editFields.email;
      if ((editFields.full_name || "") !== (editTarget.full_name || "")) payload.full_name = editFields.full_name;
      if (editFields.is_admin !== editTarget.is_admin) payload.is_admin = editFields.is_admin;
      if (editFields.is_subscribed !== editTarget.is_subscribed) payload.is_subscribed = editFields.is_subscribed;
      if (editFields.is_active !== editTarget.is_active) payload.is_active = editFields.is_active;
      if ((editFields.subscription_tier || "") !== (editTarget.subscription_tier || "")) payload.subscription_tier = editFields.subscription_tier || "";
      if ((editFields.client_id || "") !== (editTarget.client_id || "")) payload.client_id = editFields.client_id || "";
      if (Object.keys(payload).length === 0) {
        setEditTarget(null);
        return;
      }
      await api(`/admin/users/${editTarget.id}`, { method: "PATCH", body: payload });
      setEditTarget(null);
      await load();
      showAlert("✓ Modifié", "Les changements sont enregistrés.");
    } catch (e: any) {
      showAlert("Erreur", e.message);
    } finally {
      setSavingEdit(false);
    }
  };

  const resetPassword = async (u: U) => {
    const ok = await showConfirm("Réinitialiser le mot de passe ?", `Un mot de passe temporaire sera généré pour ${u.email}. Vous devrez le transmettre au client.`);
    if (!ok) return;
    try {
      const r = await api<{ temporary_password: string; email: string }>(`/admin/users/${u.id}/reset-password`, { method: "POST" });
      try { await Clipboard.setStringAsync(r.temporary_password); } catch {}
      showAlert(
        "🔑 Mot de passe temporaire",
        `Email : ${r.email}\nNouveau mdp : ${r.temporary_password}\n\n(Copié dans le presse-papier — transmettez-le au client par WhatsApp/email.)`
      );
    } catch (e: any) {
      showAlert("Erreur", e.message);
    }
  };

  const deleteUser = async (u: U) => {
    if (u.id === me?.id) {
      showAlert("Action interdite", "Vous ne pouvez pas supprimer votre propre compte.");
      return;
    }
    const ok = await showConfirm("Supprimer définitivement ?", `Cette action est IRRÉVERSIBLE. Toutes les données de ${u.email} (déblocages, codes générés, demandes) seront effacées.`);
    if (!ok) return;
    try {
      await api(`/admin/users/${u.id}`, { method: "DELETE" });
      await load();
      showAlert("✓ Supprimé", `Le compte ${u.email} a été supprimé.`);
    } catch (e: any) {
      showAlert("Erreur", e.message);
    }
  };

  const exportCsv = async () => {
    const url = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api/admin/users/export.csv`;
    try {
      await Linking.openURL(url);
    } catch {
      showAlert("Erreur", "Impossible d'ouvrir l'export CSV. URL : " + url);
    }
  };

  const formatLastLogin = (u: U): string => {
    if (!u.last_login_at) return "Jamais connecté";
    const d = u.days_inactive ?? 0;
    if (d === 0) return "Aujourd'hui";
    if (d === 1) return "Hier";
    if (d < 7) return `Il y a ${d}j`;
    if (d < 30) return `Il y a ${Math.floor(d / 7)} sem.`;
    if (d < 365) return `Il y a ${Math.floor(d / 30)} mois`;
    return `Il y a ${Math.floor(d / 365)} an${Math.floor(d / 365) > 1 ? "s" : ""}`;
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="users-back">
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={styles.title}>Utilisateurs ({filtered.length}/{users.length})</Text>
        <TouchableOpacity onPress={exportCsv} testID="users-export-csv" style={styles.iconBtn}>
          <Ionicons name="download-outline" size={22} color={colors.gold} />
        </TouchableOpacity>
      </View>

      {/* Search + Filters */}
      <View style={styles.filterBar}>
        <View style={styles.searchBox}>
          <Ionicons name="search" size={16} color={colors.textSecondary} />
          <TextInput
            placeholder="Rechercher email ou nom..."
            placeholderTextColor={colors.textDisabled}
            value={search}
            onChangeText={setSearch}
            style={styles.searchInput}
          />
          {search ? (
            <TouchableOpacity onPress={() => setSearch("")}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
          {([
            { k: "all", label: "Tous" },
            { k: "active", label: "Actifs (<90j)" },
            { k: "inactive", label: "Inactifs (>90j)" },
            { k: "never", label: "Jamais connectés" },
          ] as { k: FilterMode; label: string }[]).map((f) => (
            <TouchableOpacity
              key={f.k}
              onPress={() => setFilter(f.k)}
              style={[styles.chip, filter === f.k && styles.chipActive]}
            >
              <Text style={[styles.chipTxt, filter === f.k && styles.chipTxtActive]}>{f.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.gold} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />
          }
        >
          {filtered.length === 0 ? (
            <Text style={styles.empty}>Aucun utilisateur ne correspond.</Text>
          ) : (
            filtered.map((u) => {
              const weddingName = u.client_id ? weddings.find((w) => w.client_id === u.client_id)?.client_name : null;
              const isInactive = (u.days_inactive ?? 0) > 90 || !u.last_login_at;
              return (
                <View key={u.id} style={[styles.row, !u.is_active && { opacity: 0.55, borderColor: colors.error, borderWidth: 1 }]} testID={`user-${u.id}`}>
                  <View style={[styles.avatar, u.is_admin && { borderColor: colors.wine }]}>
                    <Text style={styles.avatarTxt}>{(u.full_name || u.email).slice(0, 1).toUpperCase()}</Text>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
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
                      {!u.is_active && <View style={[styles.tag, { backgroundColor: colors.error }]}><Text style={styles.tagTxt}>DÉSACTIVÉ</Text></View>}
                    </View>
                    <Text style={styles.email} numberOfLines={1}>{u.email}</Text>
                    {weddingName ? (
                      <View style={styles.weddingChip}>
                        <Ionicons name="heart" size={11} color={colors.gold} />
                        <Text style={styles.weddingChipTxt} numberOfLines={1}>{weddingName}</Text>
                      </View>
                    ) : null}
                    <Text style={[styles.meta, isInactive && { color: colors.error }]}>
                      {formatLastLogin(u)} · {u.unlocks} déblo. · Créé {u.created_at ? new Date(u.created_at).toLocaleDateString("fr-FR") : "?"}
                    </Text>
                  </View>
                  <View style={{ gap: 4 }}>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => openEdit(u)} testID={`edit-${u.id}`}>
                      <Ionicons name="create-outline" size={16} color={colors.gold} />
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn} onPress={() => resetPassword(u)} testID={`reset-${u.id}`}>
                      <Ionicons name="key-outline" size={16} color={colors.gold} />
                    </TouchableOpacity>
                    {u.id !== me?.id && (
                      <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.error }]} onPress={() => deleteUser(u)} testID={`delete-${u.id}`}>
                        <Ionicons name="trash-outline" size={16} color={colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}

      {/* Edit modal */}
      <Modal visible={!!editTarget} animationType="slide" transparent onRequestClose={() => setEditTarget(null)}>
        <KeyboardAvoidingView style={styles.modalBg} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: "flex-end" }} keyboardShouldPersistTaps="handled">
            <View style={styles.modal}>
              <View style={styles.modalHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.modalTitle}>Modifier l'utilisateur</Text>
                  <Text style={styles.modalSub}>{editTarget?.email}</Text>
                </View>
                <TouchableOpacity onPress={() => setEditTarget(null)} disabled={savingEdit}>
                  <Ionicons name="close" size={26} color={colors.ivory} />
                </TouchableOpacity>
              </View>

              <Text style={styles.label}>Email</Text>
              <TextInput
                style={styles.input}
                value={editFields.email}
                onChangeText={(t) => setEditFields((f) => ({ ...f, email: t }))}
                placeholder="email@example.com"
                placeholderTextColor={colors.textDisabled}
                keyboardType="email-address"
                autoCapitalize="none"
              />

              <Text style={styles.label}>Nom complet</Text>
              <TextInput
                style={styles.input}
                value={editFields.full_name || ""}
                onChangeText={(t) => setEditFields((f) => ({ ...f, full_name: t }))}
                placeholder="Prénom Nom"
                placeholderTextColor={colors.textDisabled}
              />

              <Text style={styles.label}>Mariage lié</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                <TouchableOpacity
                  onPress={() => setEditFields((f) => ({ ...f, client_id: null }))}
                  style={[styles.weddingPick, !editFields.client_id && styles.weddingPickActive]}
                >
                  <Text style={[styles.weddingPickTxt, !editFields.client_id && { color: colors.gold, fontWeight: "700" }]}>(aucun)</Text>
                </TouchableOpacity>
                {weddings.map((w) => (
                  <TouchableOpacity
                    key={w.client_id}
                    onPress={() => setEditFields((f) => ({ ...f, client_id: w.client_id }))}
                    style={[styles.weddingPick, editFields.client_id === w.client_id && styles.weddingPickActive]}
                  >
                    <Text style={[styles.weddingPickTxt, editFields.client_id === w.client_id && { color: colors.gold, fontWeight: "700" }]}>{w.client_name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              <View style={styles.toggleRow}>
                <Text style={styles.label}>Compte actif</Text>
                <Switch
                  value={editFields.is_active ?? true}
                  onValueChange={(v) => setEditFields((f) => ({ ...f, is_active: v }))}
                  trackColor={{ true: colors.gold, false: colors.surfaceElevated }}
                  disabled={editTarget?.id === me?.id}
                />
              </View>

              <View style={styles.toggleRow}>
                <Text style={styles.label}>Premium (abonné)</Text>
                <Switch
                  value={editFields.is_subscribed ?? false}
                  onValueChange={(v) => setEditFields((f) => ({ ...f, is_subscribed: v }))}
                  trackColor={{ true: colors.gold, false: colors.surfaceElevated }}
                />
              </View>

              {editFields.is_subscribed && (
                <View style={styles.tierRow}>
                  <TouchableOpacity
                    onPress={() => setEditFields((f) => ({ ...f, subscription_tier: "basic" }))}
                    style={[styles.tierBtn, (editFields.subscription_tier === "basic" || !editFields.subscription_tier) && styles.tierBtnActive]}
                  >
                    <Text style={[styles.tierBtnTxt, (editFields.subscription_tier === "basic" || !editFields.subscription_tier) && { color: colors.gold }]}>Basic 1,99€</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => setEditFields((f) => ({ ...f, subscription_tier: "unlimited" }))}
                    style={[styles.tierBtn, editFields.subscription_tier === "unlimited" && styles.tierBtnActive]}
                  >
                    <Text style={[styles.tierBtnTxt, editFields.subscription_tier === "unlimited" && { color: colors.gold }]}>Illimité 2,30€</Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.toggleRow}>
                <Text style={styles.label}>Administrateur</Text>
                <Switch
                  value={editFields.is_admin ?? false}
                  onValueChange={(v) => setEditFields((f) => ({ ...f, is_admin: v }))}
                  trackColor={{ true: colors.wine, false: colors.surfaceElevated }}
                />
              </View>

              <TouchableOpacity style={styles.saveBtn} onPress={saveEdit} disabled={savingEdit}>
                {savingEdit ? <ActivityIndicator color="#0A0A0A" /> : <Text style={styles.saveBtnTxt}>Enregistrer</Text>}
              </TouchableOpacity>
            </View>
          </ScrollView>
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
  iconBtn: { width: 38, height: 38, borderRadius: 8, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.gold },
  filterBar: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: spacing.sm },
  searchBox: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: Platform.OS === "ios" ? 10 : 4 },
  searchInput: { flex: 1, color: colors.ivory, fontSize: 14 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 14, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { borderColor: colors.gold, backgroundColor: "rgba(212,175,55,0.12)" },
  chipTxt: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  chipTxtActive: { color: colors.gold },
  empty: { color: colors.textSecondary, textAlign: "center", padding: spacing.lg, fontStyle: "italic" },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.md, marginBottom: 8 },
  avatar: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.surfaceElevated, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
  avatarTxt: { color: colors.gold, fontSize: 18, fontWeight: "700" },
  name: { color: colors.ivory, fontSize: 14, fontWeight: "600" },
  email: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  meta: { color: colors.textDisabled, fontSize: 10, marginTop: 4 },
  tag: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 },
  tagTxt: { color: colors.ivory, fontSize: 9, fontWeight: "700", letterSpacing: 0.5 },
  weddingChip: { flexDirection: "row", alignSelf: "flex-start", alignItems: "center", gap: 4, backgroundColor: "rgba(212,175,55,0.12)", borderWidth: 1, borderColor: colors.gold, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 10, marginTop: 4, maxWidth: 200 },
  weddingChipTxt: { color: colors.gold, fontSize: 10, fontWeight: "600", maxWidth: 150 },
  actionBtn: { width: 32, height: 32, borderRadius: 6, borderWidth: 1, borderColor: colors.gold, alignItems: "center", justifyContent: "center" },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)" },
  modal: { backgroundColor: colors.surfaceElevated, padding: spacing.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: spacing.xl, borderTopWidth: 1, borderColor: colors.gold },
  modalHeader: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  modalTitle: { color: colors.ivory, fontSize: 20, fontWeight: "700" },
  modalSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  label: { color: colors.ivory, fontSize: 13, fontWeight: "600", marginTop: spacing.sm, marginBottom: 6 },
  input: { backgroundColor: colors.bg, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 12, paddingVertical: Platform.OS === "ios" ? 12 : 8, color: colors.ivory, fontSize: 14 },
  toggleRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  tierRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  tierBtn: { flex: 1, borderWidth: 1, borderColor: colors.border, paddingVertical: 10, borderRadius: 8, alignItems: "center" },
  tierBtnActive: { borderColor: colors.gold, backgroundColor: "rgba(212,175,55,0.08)" },
  tierBtnTxt: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  weddingPick: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.bg },
  weddingPickActive: { borderColor: colors.gold, backgroundColor: "rgba(212,175,55,0.08)" },
  weddingPickTxt: { color: colors.ivory, fontSize: 12 },
  saveBtn: { marginTop: spacing.lg, backgroundColor: colors.gold, paddingVertical: 14, borderRadius: 10, alignItems: "center" },
  saveBtnTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15 },
});

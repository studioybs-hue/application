import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, TextInput, KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert, confirmAction } from "@/src/utils/dialog";

type DeletionRequest = {
  id: string;
  user_id: string;
  email: string;
  full_name?: string;
  status: "pending" | "approved" | "rejected";
  requested_at: string;
  processed_at?: string;
  admin_note?: string;
};

export default function AdminDeletionRequestsScreen() {
  const router = useRouter();
  const [items, setItems] = useState<DeletionRequest[]>([]);
  const [filter, setFilter] = useState<"pending" | "all">("pending");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: DeletionRequest[] }>(`/admin/deletion-requests?status=${filter}`);
      setItems(r.items || []);
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Impossible de charger les demandes");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const approve = (req: DeletionRequest) => {
    confirmAction(
      "Approuver la suppression",
      `Cela supprimera DÉFINITIVEMENT le compte de ${req.email} et toutes ses données. Action irréversible. Confirmer ?`,
      async () => {
        setBusyId(req.id);
        try {
          await api(`/admin/deletion-requests/${req.id}/approve`, { method: "POST", body: {} });
          showAlert("Compte supprimé", `Les données de ${req.email} ont été effacées. Email de confirmation envoyé.`);
          await load();
        } catch (e: any) {
          showAlert("Erreur", e?.message || "Échec de l'approbation");
        } finally { setBusyId(null); }
      },
      { confirmText: "Approuver et supprimer", destructive: true }
    );
  };

  const submitReject = async () => {
    if (!rejectId) return;
    if (rejectReason.trim().length < 5) {
      showAlert("Motif requis", "Veuillez préciser un motif clair (min. 5 caractères).");
      return;
    }
    setBusyId(rejectId);
    try {
      await api(`/admin/deletion-requests/${rejectId}/reject`, { method: "POST", body: { reason: rejectReason.trim() } });
      showAlert("Demande rejetée", "L'utilisateur a été notifié par email.");
      setRejectId(null); setRejectReason(""); await load();
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Échec du rejet");
    } finally { setBusyId(null); }
  };

  const formatDate = (iso?: string) => {
    if (!iso) return "—";
    try { return new Date(iso).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" }); }
    catch { return iso; }
  };

  const statusBadge = (s: string) => {
    if (s === "pending") return { txt: "En attente", color: colors.gold, bg: "rgba(212,175,55,0.15)" };
    if (s === "approved") return { txt: "Supprimé", color: "#E53935", bg: "rgba(229,57,53,0.15)" };
    return { txt: "Rejeté", color: "#9A9A9A", bg: "rgba(154,154,154,0.15)" };
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.ivory} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Suppressions RGPD</Text>
            <Text style={styles.subtitle}>{items.length} demande{items.length > 1 ? "s" : ""} — {filter === "pending" ? "en attente" : "toutes"}</Text>
          </View>
        </View>

        <View style={styles.filterRow}>
          <FilterChip label="En attente" active={filter === "pending"} onPress={() => setFilter("pending")} />
          <FilterChip label="Toutes" active={filter === "all"} onPress={() => setFilter("all")} />
        </View>

        <ScrollView
          contentContainerStyle={styles.scroll}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
        >
          {loading ? (
            <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} />
          ) : items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="checkmark-circle-outline" size={56} color={colors.textDisabled} />
              <Text style={styles.emptyTxt}>Aucune demande {filter === "pending" ? "en attente" : ""}</Text>
            </View>
          ) : (
            items.map((req) => {
              const badge = statusBadge(req.status);
              const isRejecting = rejectId === req.id;
              return (
                <View key={req.id} style={styles.card}>
                  <View style={styles.cardHeader}>
                    <View style={[styles.badge, { backgroundColor: badge.bg }]}>
                      <Text style={[styles.badgeTxt, { color: badge.color }]}>{badge.txt}</Text>
                    </View>
                    <Text style={styles.cardDate}>{formatDate(req.requested_at)}</Text>
                  </View>
                  <Text style={styles.cardName}>{req.full_name || "(sans nom)"}</Text>
                  <Text style={styles.cardEmail}>{req.email}</Text>
                  <Text style={styles.cardId}>Réf. {req.id.slice(0, 8).toUpperCase()}</Text>

                  {req.admin_note ? (
                    <View style={styles.noteBox}>
                      <Text style={styles.noteLabel}>Motif :</Text>
                      <Text style={styles.noteTxt}>{req.admin_note}</Text>
                    </View>
                  ) : null}

                  {req.status === "pending" && !isRejecting ? (
                    <View style={styles.actions}>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.approveBtn]}
                        onPress={() => approve(req)}
                        disabled={busyId === req.id}
                      >
                        {busyId === req.id ? (
                          <ActivityIndicator color="#0A0A0A" size="small" />
                        ) : (
                          <>
                            <Ionicons name="checkmark" size={18} color="#0A0A0A" />
                            <Text style={styles.approveTxt}>Approuver</Text>
                          </>
                        )}
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[styles.actionBtn, styles.rejectBtn]}
                        onPress={() => { setRejectId(req.id); setRejectReason(""); }}
                        disabled={busyId === req.id}
                      >
                        <Ionicons name="close" size={18} color="#E53935" />
                        <Text style={styles.rejectTxt}>Rejeter</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}

                  {isRejecting ? (
                    <View style={styles.rejectForm}>
                      <Text style={styles.rejectLabel}>Motif du rejet (sera envoyé à l'utilisateur)</Text>
                      <TextInput
                        style={styles.rejectInput}
                        value={rejectReason}
                        onChangeText={setRejectReason}
                        placeholder="Ex: Contrat d'hébergement en cours..."
                        placeholderTextColor={colors.textDisabled}
                        multiline
                      />
                      <View style={styles.rejectActions}>
                        <TouchableOpacity onPress={() => { setRejectId(null); setRejectReason(""); }} style={[styles.actionBtn, { borderWidth: 1, borderColor: colors.border }]}>
                          <Text style={{ color: colors.textSecondary }}>Annuler</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={submitReject} disabled={busyId === req.id} style={[styles.actionBtn, styles.rejectConfirmBtn]}>
                          {busyId === req.id ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: "#fff", fontWeight: "700" }}>Confirmer le rejet</Text>}
                        </TouchableOpacity>
                      </View>
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function FilterChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity style={[styles.chip, active && styles.chipActive]} onPress={onPress}>
      <Text style={[styles.chipTxt, active && styles.chipTxtActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 8 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { color: colors.ivory, fontSize: 20, fontWeight: "800" },
  subtitle: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  filterRow: { flexDirection: "row", paddingHorizontal: spacing.md, gap: 8, marginBottom: spacing.sm },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  chipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipTxt: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
  chipTxtActive: { color: "#0A0A0A" },
  scroll: { padding: spacing.md, paddingBottom: 80, gap: spacing.sm },
  empty: { alignItems: "center", marginTop: 60, gap: 12 },
  emptyTxt: { color: colors.textDisabled, fontSize: 14 },
  card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)", marginBottom: spacing.sm },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  badge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  badgeTxt: { fontSize: 11, fontWeight: "700", letterSpacing: 0.5 },
  cardDate: { color: colors.textDisabled, fontSize: 11 },
  cardName: { color: colors.ivory, fontSize: 16, fontWeight: "700" },
  cardEmail: { color: colors.gold, fontSize: 13, marginTop: 2 },
  cardId: { color: colors.textDisabled, fontSize: 11, marginTop: 4, fontFamily: Platform.OS === "ios" ? "Courier" : "monospace" },
  noteBox: { marginTop: 10, padding: 10, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.04)", borderLeftWidth: 3, borderLeftColor: colors.gold },
  noteLabel: { color: colors.textSecondary, fontSize: 10, fontWeight: "700", textTransform: "uppercase", letterSpacing: 1 },
  noteTxt: { color: colors.ivory, fontSize: 13, marginTop: 4, lineHeight: 18 },
  actions: { flexDirection: "row", gap: 8, marginTop: spacing.md },
  actionBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, paddingVertical: 12, borderRadius: 6 },
  approveBtn: { backgroundColor: colors.gold },
  approveTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 13 },
  rejectBtn: { borderWidth: 1, borderColor: "#E53935", backgroundColor: "rgba(229,57,53,0.08)" },
  rejectTxt: { color: "#E53935", fontWeight: "700", fontSize: 13 },
  rejectForm: { marginTop: spacing.md, gap: 8 },
  rejectLabel: { color: colors.textSecondary, fontSize: 11, textTransform: "uppercase", letterSpacing: 1 },
  rejectInput: { color: colors.ivory, backgroundColor: colors.bg, padding: 12, borderRadius: 6, borderWidth: 1, borderColor: colors.border, minHeight: 80, fontSize: 14, textAlignVertical: "top" },
  rejectActions: { flexDirection: "row", gap: 8 },
  rejectConfirmBtn: { backgroundColor: "#E53935" },
});

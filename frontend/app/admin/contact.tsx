import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  RefreshControl,
  Linking,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert } from "@/src/utils/dialog";
import { useConfirm } from "@/src/ui/ConfirmDialog";

type ContactReq = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  wedding_date?: string;
  location?: string;
  message: string;
  source?: string;
  status: "new" | "read" | "archived";
  created_at: string;
  notes?: string;
};

const STATUS_LABEL: Record<string, string> = {
  new: "Nouveau",
  read: "Lu",
  archived: "Archivé",
};
const STATUS_COLOR: Record<string, string> = {
  new: "#22c55e",
  read: "#f59e0b",
  archived: "#6b7280",
};

export default function AdminContactRequests() {
  const router = useRouter();
  const confirm = useConfirm();
  const [requests, setRequests] = useState<ContactReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "new" | "read" | "archived">("all");

  const load = useCallback(async () => {
    try {
      const r = await api<{ requests: ContactReq[] }>("/admin/contact-requests");
      setRequests(r.requests || []);
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Impossible de charger les demandes.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const onRefresh = () => {
    setRefreshing(true);
    load();
  };

  const updateStatus = async (id: string, status: ContactReq["status"]) => {
    try {
      await api(`/admin/contact-requests/${id}`, { method: "PATCH", body: { status } });
      setRequests((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Action impossible.");
    }
  };

  const remove = async (id: string) => {
    const ok = await confirm({
      title: "Supprimer la demande ?",
      message: "Cette action est irréversible.",
      confirmText: "Supprimer",
      destructive: true,
    });
    if (!ok) return;
    try {
      await api(`/admin/contact-requests/${id}`, { method: "DELETE" });
      setRequests((prev) => prev.filter((r) => r.id !== id));
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Suppression impossible.");
    }
  };

  const filtered = filter === "all" ? requests : requests.filter((r) => r.status === filter);
  const newCount = requests.filter((r) => r.status === "new").length;

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.headerWrap} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="contact-admin-back">
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
          <View style={{ flex: 1, alignItems: "center" }}>
            <Text style={styles.headerTitle}>Demandes de devis</Text>
            <Text style={styles.headerSub}>{requests.length} total · {newCount} nouveau{newCount > 1 ? "x" : ""}</Text>
          </View>
          <View style={{ width: 40 }} />
        </View>

        {/* Filter tabs */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.filterRow}
        >
          {[
            { key: "all", label: `Tous (${requests.length})` },
            { key: "new", label: `Nouveau (${newCount})` },
            { key: "read", label: "Lus" },
            { key: "archived", label: "Archivés" },
          ].map((tab) => (
            <TouchableOpacity
              key={tab.key}
              style={[styles.filterChip, filter === tab.key && styles.filterChipActive]}
              onPress={() => setFilter(tab.key as any)}
              testID={`filter-${tab.key}`}
            >
              <Text style={[styles.filterTxt, filter === tab.key && styles.filterTxtActive]}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </SafeAreaView>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.gold} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.gold} />}
        >
          {filtered.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="mail-open-outline" size={48} color={colors.textDisabled} />
              <Text style={styles.emptyTxt}>Aucune demande pour le moment.</Text>
              <Text style={styles.emptySub}>Les demandes envoyées via la page "À propos" apparaîtront ici.</Text>
            </View>
          ) : (
            filtered.map((req) => (
              <View key={req.id} style={styles.card} testID={`contact-card-${req.id}`}>
                <View style={styles.cardHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.cardName}>{req.name}</Text>
                    <Text style={styles.cardDate}>{formatDate(req.created_at)}</Text>
                  </View>
                  <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR[req.status] }]}>
                    <Text style={styles.statusTxt}>{STATUS_LABEL[req.status]}</Text>
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.contactBtn}
                  onPress={() => Linking.openURL(`mailto:${req.email}?subject=Re: Devis CINÉMARIÉS`)}
                  testID={`contact-email-${req.id}`}
                >
                  <Ionicons name="mail" size={14} color={colors.gold} />
                  <Text style={styles.contactTxt}>{req.email}</Text>
                </TouchableOpacity>

                {req.phone ? (
                  <TouchableOpacity
                    style={styles.contactBtn}
                    onPress={() => Linking.openURL(`tel:${req.phone}`)}
                    testID={`contact-phone-${req.id}`}
                  >
                    <Ionicons name="call" size={14} color={colors.gold} />
                    <Text style={styles.contactTxt}>{req.phone}</Text>
                  </TouchableOpacity>
                ) : null}

                {req.wedding_date || req.location ? (
                  <View style={styles.metaRow}>
                    {req.wedding_date ? (
                      <View style={styles.metaItem}>
                        <Ionicons name="calendar" size={12} color={colors.textSecondary} />
                        <Text style={styles.metaTxt}>{req.wedding_date}</Text>
                      </View>
                    ) : null}
                    {req.location ? (
                      <View style={styles.metaItem}>
                        <Ionicons name="location" size={12} color={colors.textSecondary} />
                        <Text style={styles.metaTxt}>{req.location}</Text>
                      </View>
                    ) : null}
                  </View>
                ) : null}

                <View style={styles.messageBox}>
                  <Text style={styles.messageTxt}>{req.message}</Text>
                </View>

                <View style={styles.actions}>
                  {req.status !== "read" && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionRead]}
                      onPress={() => updateStatus(req.id, "read")}
                      testID={`mark-read-${req.id}`}
                    >
                      <Ionicons name="checkmark" size={14} color="#fff" />
                      <Text style={styles.actionTxt}>Marquer lu</Text>
                    </TouchableOpacity>
                  )}
                  {req.status !== "archived" && (
                    <TouchableOpacity
                      style={[styles.actionBtn, styles.actionArchive]}
                      onPress={() => updateStatus(req.id, "archived")}
                      testID={`archive-${req.id}`}
                    >
                      <Ionicons name="archive" size={14} color="#fff" />
                      <Text style={styles.actionTxt}>Archiver</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.actionDelete]}
                    onPress={() => remove(req.id)}
                    testID={`delete-${req.id}`}
                  >
                    <Ionicons name="trash" size={14} color="#fff" />
                    <Text style={styles.actionTxt}>Supprimer</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </View>
  );
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerWrap: { backgroundColor: colors.bg, borderBottomWidth: 1, borderBottomColor: colors.border },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(255,255,255,0.06)", alignItems: "center", justifyContent: "center" },
  headerTitle: { color: colors.ivory, fontSize: 16, fontWeight: "700", letterSpacing: 1 },
  headerSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },

  filterRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: 8 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginRight: 8 },
  filterChipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  filterTxt: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  filterTxtActive: { color: "#0A0A0A", fontWeight: "800" },

  loading: { flex: 1, alignItems: "center", justifyContent: "center" },

  empty: { padding: spacing.xl, alignItems: "center" },
  emptyTxt: { color: colors.ivory, fontSize: 14, fontWeight: "600", marginTop: spacing.md, textAlign: "center" },
  emptySub: { color: colors.textSecondary, fontSize: 12, marginTop: 4, textAlign: "center" },

  card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.border },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", marginBottom: 8 },
  cardName: { color: colors.ivory, fontSize: 16, fontWeight: "700" },
  cardDate: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  statusBadge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  statusTxt: { color: "#fff", fontSize: 10, fontWeight: "800", letterSpacing: 0.5 },

  contactBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  contactTxt: { color: colors.gold, fontSize: 13, textDecorationLine: "underline" },

  metaRow: { flexDirection: "row", gap: 12, marginTop: 6, flexWrap: "wrap" },
  metaItem: { flexDirection: "row", alignItems: "center", gap: 4 },
  metaTxt: { color: colors.textSecondary, fontSize: 11 },

  messageBox: { backgroundColor: "rgba(0,0,0,0.3)", padding: 10, borderRadius: radii.sm, marginTop: 10 },
  messageTxt: { color: colors.ivory, fontSize: 13, lineHeight: 19 },

  actions: { flexDirection: "row", gap: 6, marginTop: 10, flexWrap: "wrap" },
  actionBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 10, paddingVertical: 6, borderRadius: radii.sm },
  actionRead: { backgroundColor: "#22c55e" },
  actionArchive: { backgroundColor: "#6b7280" },
  actionDelete: { backgroundColor: colors.wine },
  actionTxt: { color: "#fff", fontSize: 11, fontWeight: "700" },
});

/** Admin: list of all support tickets with filters and badges */
import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { showAlert, showConfirm } from "@/src/utils/dialog";
import { colors, spacing, radii } from "@/src/theme";
import { Ticket, STATUS_LABEL, STATUS_COLOR } from "@/src/support/types";

const FILTERS: { key: "all" | Ticket["status"]; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "open", label: "Ouverts" },
  { key: "in_progress", label: "En cours" },
  { key: "closed", label: "Clôturés" },
];

export default function AdminSupportList() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [filter, setFilter] = useState<"all" | Ticket["status"]>("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [totalUnread, setTotalUnread] = useState(0);
  const [openCount, setOpenCount] = useState(0);

  const load = useCallback(async () => {
    try {
      const qs = filter === "all" ? "" : `?status=${filter}`;
      const r = await api<{ tickets: Ticket[]; total_unread: number; open_count: number }>(`/admin/support/tickets${qs}`);
      setTickets(r.tickets || []);
      setTotalUnread(r.total_unread || 0);
      setOpenCount(r.open_count || 0);
    } catch (e: any) {
      showAlert("Erreur", e.message || "Erreur de chargement");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useFocusEffect(
    useCallback(() => {
      if (!user || !user.is_admin) return;
      load();
      const i = setInterval(load, 10000);
      return () => clearInterval(i);
    }, [user, load])
  );

  useEffect(() => {
    if (!authLoading && (!user || !user.is_admin)) {
      router.replace("/admin");
    }
  }, [authLoading, user, router]);

  const deleteTicket = async (t: Ticket) => {
    const ok = await showConfirm(
      "Supprimer ce ticket ?",
      `« ${t.subject} » sera définitivement supprimé, ainsi que tous ses messages.`,
      { confirmText: "Supprimer", destructive: true }
    );
    if (!ok) return;
    try {
      await api(`/admin/support/tickets/${t.id}`, { method: "DELETE" });
      setTickets((prev) => prev.filter((x) => x.id !== t.id));
    } catch (e: any) {
      showAlert("Erreur", e.message);
    }
  };

  if (authLoading || (loading && tickets.length === 0)) {
    return <View style={styles.loading}><ActivityIndicator color={colors.gold} /></View>;
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle}>Support</Text>
          <Text style={styles.headerSub}>
            {openCount} ouvert{openCount > 1 ? "s" : ""} · {totalUnread} non lu{totalUnread > 1 ? "s" : ""}
          </Text>
        </View>
        <View style={{ width: 26 }} />
      </View>

      <View style={styles.filters}>
        {FILTERS.map((f) => (
          <TouchableOpacity
            key={f.key}
            style={[styles.filterChip, filter === f.key && styles.filterChipActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[styles.filterChipTxt, filter === f.key && { color: "#0A0A0A", fontWeight: "700" }]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={tickets}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
        ListEmptyComponent={
          <Text style={styles.empty}>Aucun ticket dans cette catégorie.</Text>
        }
        renderItem={({ item }) => {
          const unread = item.unread_for_admin || 0;
          return (
            <TouchableOpacity
              style={[styles.ticketCard, unread > 0 && styles.ticketCardUnread]}
              onPress={() => router.push(`/admin/support/${item.id}`)}
              onLongPress={() => deleteTicket(item)}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[item.status] }]} />
                  <Text style={styles.statusLabel}>{STATUS_LABEL[item.status]}</Text>
                  <Text style={styles.userInfo}> · {item.user_name || item.user_email}</Text>
                </View>
                <Text style={styles.ticketSubject} numberOfLines={1}>{item.subject}</Text>
                <Text style={styles.ticketDate}>
                  {new Date(item.last_message_at).toLocaleDateString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </Text>
              </View>
              {unread > 0 && (
                <View style={styles.badge}>
                  <Text style={styles.badgeTxt}>{unread}</Text>
                </View>
              )}
              <Ionicons name="chevron-forward" size={18} color={colors.textDisabled} />
            </TouchableOpacity>
          );
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 10 },
  headerTitle: { color: colors.ivory, fontSize: 18, fontWeight: "700" },
  headerSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  filters: { flexDirection: "row", paddingHorizontal: spacing.md, paddingBottom: 8, gap: 6 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterChipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  filterChipTxt: { color: colors.ivory, fontSize: 12 },
  empty: { color: colors.textSecondary, textAlign: "center", marginTop: 60, fontStyle: "italic" },
  ticketCard: { flexDirection: "row", alignItems: "center", gap: 10, padding: 14, backgroundColor: colors.surface, borderRadius: radii.md, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  ticketCardUnread: { borderColor: colors.gold, backgroundColor: "rgba(212,175,55,0.06)" },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { color: colors.textSecondary, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase" },
  userInfo: { color: colors.gold, fontSize: 11 },
  ticketSubject: { color: colors.ivory, fontSize: 15, fontWeight: "600", marginTop: 4 },
  ticketDate: { color: colors.textDisabled, fontSize: 11, marginTop: 4 },
  badge: { backgroundColor: colors.gold, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, minWidth: 22, alignItems: "center" },
  badgeTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 11 },
});

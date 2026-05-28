/**
 * User-facing list of support tickets.
 * Polls every 15s to refresh badges.
 */
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
import { colors, spacing, radii } from "@/src/theme";
import { Ticket, STATUS_LABEL, STATUS_COLOR } from "@/src/support/types";

export default function SupportList() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ tickets: Ticket[] }>("/support/tickets");
      setTickets(r.tickets || []);
    } catch (e) {
      // silent
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      if (!user) return;
      load();
      const i = setInterval(load, 15000);
      return () => clearInterval(i);
    }, [user, load])
  );

  useEffect(() => {
    if (!authLoading && !user) {
      router.replace("/auth/login");
    }
  }, [authLoading, user, router]);

  if (authLoading || (loading && tickets.length === 0)) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="support-back">
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Aide & Support</Text>
        <View style={{ width: 26 }} />
      </View>

      <FlatList
        data={tickets}
        keyExtractor={(t) => t.id}
        contentContainerStyle={{ padding: spacing.md, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
        ListEmptyComponent={
          <View style={styles.emptyBox}>
            <Ionicons name="chatbubbles" size={40} color={colors.gold} />
            <Text style={styles.emptyTitle}>Aucun ticket pour le moment</Text>
            <Text style={styles.emptyTxt}>Posez-nous une question ou signalez un problème. Notre équipe vous répond rapidement.</Text>
          </View>
        }
        renderItem={({ item }) => {
          const unread = item.unread_for_user || 0;
          return (
            <TouchableOpacity
              style={styles.ticketCard}
              onPress={() => router.push(`/support/${item.id}`)}
              testID={`ticket-${item.id}`}
            >
              <View style={{ flex: 1 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[item.status] }]} />
                  <Text style={styles.statusLabel}>{STATUS_LABEL[item.status]}</Text>
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

      <TouchableOpacity
        style={styles.fab}
        onPress={() => router.push("/support/new")}
        testID="support-new-ticket-btn"
      >
        <Ionicons name="add" size={24} color="#0A0A0A" />
        <Text style={styles.fabTxt}>Nouvelle demande</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 10 },
  headerTitle: { flex: 1, color: colors.ivory, fontSize: 18, fontWeight: "700", textAlign: "center" },
  emptyBox: { alignItems: "center", padding: 40, marginTop: 40 },
  emptyTitle: { color: colors.ivory, fontSize: 16, fontWeight: "700", marginTop: 12 },
  emptyTxt: { color: colors.textSecondary, fontSize: 13, textAlign: "center", marginTop: 8, lineHeight: 19 },
  ticketCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    padding: 14,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  statusLabel: { color: colors.textSecondary, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase" },
  ticketSubject: { color: colors.ivory, fontSize: 15, fontWeight: "600", marginTop: 4 },
  ticketDate: { color: colors.textDisabled, fontSize: 11, marginTop: 4 },
  badge: { backgroundColor: colors.gold, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, minWidth: 22, alignItems: "center" },
  badgeTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 11 },
  fab: { position: "absolute", bottom: 30, right: 20, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.gold, paddingHorizontal: 16, paddingVertical: 14, borderRadius: 999, elevation: 6 },
  fabTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 14 },
});

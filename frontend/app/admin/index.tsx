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
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";

type Stats = {
  users: number;
  premium: number;
  videos: number;
  codes_total: number;
  codes_active: number;
  unlocks_total: number;
  top_videos: { title: string; poster_url?: string; unlocks: number }[];
};

export default function AdminDashboard() {
  const router = useRouter();
  const [stats, setStats] = useState<Stats | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const s = await api<Stats>("/admin/stats");
      setStats(s);
    } catch (e) {
      console.error(e);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="admin-back">
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <View>
          <Text style={styles.brand}>ADMIN</Text>
          <Text style={styles.brandSub}>CINÉMARIÉS</Text>
        </View>
        <View style={{ width: 26 }} />
      </View>

      {!stats ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.gold} />
        </View>
      ) : (
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
          <Text style={styles.h1}>Tableau de bord</Text>

          <View style={styles.statsGrid}>
            <StatCard icon="people-outline" value={stats.users} label="Utilisateurs" testID="stat-users" />
            <StatCard icon="star" value={stats.premium} label="Premium" gold testID="stat-premium" />
            <StatCard icon="film-outline" value={stats.videos} label="Vidéos" testID="stat-videos" />
            <StatCard icon="key-outline" value={stats.codes_active} label="Codes actifs" testID="stat-codes" />
          </View>

          <View style={styles.secondaryRow}>
            <View style={styles.secondaryCard}>
              <Text style={styles.smallLabel}>Total codes</Text>
              <Text style={styles.smallValue}>{stats.codes_total}</Text>
            </View>
            <View style={styles.secondaryCard}>
              <Text style={styles.smallLabel}>Total déblocages</Text>
              <Text style={styles.smallValue}>{stats.unlocks_total}</Text>
            </View>
          </View>

          <Text style={styles.h2}>Actions</Text>
          <View style={styles.actionsList}>
            <ActionRow
              icon="film-outline"
              label="Gestion des vidéos"
              hint="Ajouter, modifier, supprimer"
              onPress={() => router.push("/admin/videos")}
              testID="admin-videos-btn"
            />
            <ActionRow
              icon="key-outline"
              label="Codes de déblocage"
              hint="Générer & gérer les codes clients"
              onPress={() => router.push("/admin/codes")}
              testID="admin-codes-btn"
            />
            <ActionRow
              icon="people-outline"
              label="Utilisateurs"
              hint="Liste & abonnements"
              onPress={() => router.push("/admin/users")}
              testID="admin-users-btn"
            />
            <ActionRow
              icon="heart-circle-outline"
              label="Demandes d'hébergement"
              hint="Couples ayant payé 90€ — à publier"
              onPress={() => router.push("/admin/hosting")}
              testID="admin-hosting-btn"
            />
            <ActionRow
              icon="chatbubbles-outline"
              label="Support / Messages"
              hint="Tickets de support des utilisateurs"
              onPress={() => router.push("/admin/support")}
              testID="admin-support-btn"
            />
            <ActionRow
              icon="mail-unread-outline"
              label="Demandes de devis"
              hint="Contacts reçus via la page À propos"
              onPress={() => router.push("/admin/contact")}
              testID="admin-contact-btn"
            />
            <ActionRow
              icon="trash-outline"
              label="Suppressions RGPD"
              hint="Demandes de suppression de compte à modérer"
              onPress={() => router.push("/admin/deletion-requests")}
              testID="admin-deletion-btn"
            />
          </View>

          <Text style={styles.h2}>Top vidéos</Text>
          {stats.top_videos.length === 0 ? (
            <Text style={styles.empty}>Aucun déblocage pour le moment.</Text>
          ) : (
            stats.top_videos.map((v) => (
              <View key={v.title} style={styles.topRow}>
                {v.poster_url ? (
                  <Image source={{ uri: v.poster_url }} style={styles.topPoster} contentFit="cover" />
                ) : (
                  <View style={[styles.topPoster, { backgroundColor: colors.surface }]} />
                )}
                <Text style={styles.topTitle} numberOfLines={1}>{v.title}</Text>
                <View style={styles.topBadge}>
                  <Text style={styles.topBadgeTxt}>{v.unlocks} déb.</Text>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatCard({ icon, value, label, gold, testID }: { icon: any; value: number; label: string; gold?: boolean; testID: string }) {
  return (
    <View style={[styles.statCard, gold && { borderColor: colors.gold }]} testID={testID}>
      <Ionicons name={icon} size={22} color={gold ? colors.gold : colors.ivory} />
      <Text style={[styles.statValue, gold && { color: colors.gold }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function ActionRow({ icon, label, hint, onPress, testID }: { icon: any; label: string; hint: string; onPress: () => void; testID: string }) {
  return (
    <TouchableOpacity style={styles.actionRow} onPress={onPress} testID={testID}>
      <View style={styles.actionIcon}>
        <Ionicons name={icon} size={20} color={colors.gold} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.actionLabel}>{label}</Text>
        <Text style={styles.actionHint}>{hint}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  brand: { color: colors.gold, fontSize: 16, fontWeight: "700", letterSpacing: 3, textAlign: "center" },
  brandSub: { color: colors.textSecondary, fontSize: 10, letterSpacing: 2, textAlign: "center" },
  h1: { color: colors.ivory, fontSize: 26, fontWeight: "700", marginBottom: spacing.md },
  h2: { color: colors.ivory, fontSize: 18, fontWeight: "700", marginTop: spacing.lg, marginBottom: spacing.sm },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.sm },
  statCard: {
    width: "48%",
    flexGrow: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  statValue: { color: colors.ivory, fontSize: 28, fontWeight: "700", marginTop: 8 },
  statLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  secondaryRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm },
  secondaryCard: { flex: 1, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.sm },
  smallLabel: { color: colors.textSecondary, fontSize: 11 },
  smallValue: { color: colors.ivory, fontSize: 20, fontWeight: "700", marginTop: 4 },
  actionsList: { gap: spacing.sm },
  actionRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.12)",
    gap: spacing.md,
  },
  actionIcon: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: "rgba(212,175,55,0.1)",
    alignItems: "center", justifyContent: "center",
  },
  actionLabel: { color: colors.ivory, fontSize: 15, fontWeight: "600" },
  actionHint: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  topRow: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    padding: spacing.sm,
    borderRadius: radii.sm,
    marginBottom: 8,
    gap: spacing.md,
  },
  topPoster: { width: 40, height: 60, borderRadius: 4 },
  topTitle: { flex: 1, color: colors.ivory, fontSize: 14, fontWeight: "600" },
  topBadge: { backgroundColor: colors.gold, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  topBadgeTxt: { color: "#0A0A0A", fontSize: 11, fontWeight: "700" },
  empty: { color: colors.textSecondary, fontStyle: "italic", textAlign: "center", padding: spacing.md },
});

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
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { IS_IOS_NATIVE } from "@/src/utils/platform";

type Active = { client_id: string; wedding_name: string; message_count: number };

export default function GuestbookListPage() {
  const router = useRouter();
  const [items, setItems] = useState<Active[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (IS_IOS_NATIVE) {
      setItems([]);
      setRefreshing(false);
      return;
    }
    try {
      const r = await api<{ items: Active[] }>("/guestbook/active", { auth: false });
      setItems(r.items);
    } catch {
      setItems([]);
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // iOS Reader App: redirect guests to the web version
  if (IS_IOS_NATIVE) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} testID="gb-list-back">
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Livre d&apos;or numérique</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.iosNotice}>
          <Ionicons name="globe-outline" size={48} color={colors.gold} />
          <Text style={styles.iosNoticeTitle}>Ouvrez depuis Safari</Text>
          <Text style={styles.iosNoticeText}>
            Le livre d&apos;or numérique est disponible sur cinemaries.fr.{"\n"}
            Scannez le QR code de votre carte d&apos;invitation ou ouvrez le lien depuis votre navigateur.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} testID="gb-list-back">
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Livre d&apos;or numérique</Text>
        <View style={{ width: 26 }} />
      </View>

      {items === null ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
        >
          <View style={styles.hero}>
            <Text style={styles.emoji}>💌</Text>
            <Text style={styles.title}>Un mot doux aux mariés</Text>
            <Text style={styles.subtle}>
              Sélectionnez le mariage auquel vous souhaitez laisser un message audio, vidéo ou texte.
            </Text>
          </View>

          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="mail-open-outline" size={50} color={colors.textDisabled} />
              <Text style={styles.emptyTitle}>Aucun livre d&apos;or actif</Text>
              <Text style={styles.emptyText}>
                Les livres d&apos;or sont activés par le studio uniquement pendant la période du mariage. Revenez plus tard ou scannez le QR code présent sur votre carte d&apos;invitation.
              </Text>
            </View>
          ) : (
            items.map((w) => (
              <TouchableOpacity
                key={w.client_id}
                style={styles.card}
                onPress={() => router.push(`/guestbook/${w.client_id}`)}
                testID={`gb-active-${w.client_id}`}
              >
                <View style={styles.cardIcon}>
                  <Text style={{ fontSize: 22 }}>💒</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{w.wedding_name}</Text>
                  <Text style={styles.cardSub}>
                    {w.message_count > 0
                      ? `${w.message_count} message${w.message_count > 1 ? "s" : ""} déjà reçu${w.message_count > 1 ? "s" : ""}`
                      : "Soyez le premier à laisser un mot"}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={22} color={colors.gold} />
              </TouchableOpacity>
            ))
          )}

          <Text style={styles.footer}>
            💡 Astuce : scannez le QR code présent sur les cartes de table du mariage pour un accès direct.
          </Text>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.gold, fontSize: 16, fontWeight: "800", letterSpacing: 1 },

  hero: { alignItems: "center", padding: spacing.lg, marginBottom: spacing.md },
  emoji: { fontSize: 48, marginBottom: 8 },
  title: { color: colors.ivory, fontSize: 22, fontWeight: "800", marginBottom: 6 },
  subtle: { color: colors.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 20 },

  empty: { alignItems: "center", padding: spacing.xl, gap: spacing.sm },
  emptyTitle: { color: colors.ivory, fontSize: 16, fontWeight: "700" },
  emptyText: { color: colors.textSecondary, fontSize: 13, textAlign: "center", lineHeight: 20 },

  card: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
    gap: spacing.md,
  },
  cardIcon: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: "rgba(212,175,55,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { color: colors.ivory, fontSize: 15, fontWeight: "700" },
  cardSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },

  footer: {
    color: colors.textSecondary,
    fontSize: 11,
    textAlign: "center",
    marginTop: spacing.xl,
    fontStyle: "italic",
    lineHeight: 16,
  },

  iosNotice: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  iosNoticeTitle: { color: colors.gold, fontSize: 22, fontWeight: "800", marginTop: 8 },
  iosNoticeText: { color: colors.ivory, fontSize: 14, textAlign: "center", lineHeight: 22 },
});

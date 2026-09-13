import { useEffect, useState, useRef } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Animated,
  Easing,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { IS_IOS_NATIVE } from "@/src/utils/platform";

type Entry = {
  id: string;
  guest_name: string;
  message_text: string;
  media_type?: string | null;
  media_url?: string | null;
  created_at: string;
};

/**
 * Couple's surprise reveal — enter unlock code, discover all messages
 * with an animated reveal, one card at a time with soft transitions.
 * WEB ONLY to stay Apple Reader App safe.
 */
export default function GuestbookRevealPage() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [autoLoading, setAutoLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{ wedding_name: string; count: number; items: Entry[] } | null>(null);
  const [revealedCount, setRevealedCount] = useState(0);
  const introAnim = useRef(new Animated.Value(0)).current;

  const revealItems = (items: Entry[]) => {
    Animated.timing(introAnim, {
      toValue: 1,
      duration: 1500,
      easing: Easing.out(Easing.ease),
      useNativeDriver: true,
    }).start();
    let i = 0;
    const total = items.length;
    const revealInterval = setInterval(() => {
      i++;
      setRevealedCount(i);
      if (i >= total) clearInterval(revealInterval);
    }, 700);
  };

  // Accès réservé aux mariés connectés : le compte Mariés relié au mariage voit ses messages sans code.
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      setAutoLoading(false);
      return;
    }
    (async () => {
      try {
        const r = await api<any>(`/guestbook/mine?client_id=${encodeURIComponent(clientId || "")}`);
        if (r && r.client_id === clientId) {
          setData(r);
          revealItems(r.items || []);
        } else {
          setError("Votre compte est relié à un autre mariage.");
        }
      } catch (e: any) {
        setError(e?.message || "Votre compte n'est pas encore relié à ce mariage.");
      } finally {
        setAutoLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, user?.id, authLoading]);

  if (IS_IOS_NATIVE) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Ionicons name="globe-outline" size={48} color={colors.gold} />
          <Text style={styles.title}>Livre d&apos;or</Text>
          <Text style={styles.subtle}>
            La révélation surprise est disponible sur cinemaries.fr depuis Safari{"\n"}pour une meilleure expérience 💌
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  // Show a loader while we check the authenticated fast-path
  if (autoLoading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.gold} size="large" />
          <Text style={[styles.subtle, { marginTop: 16 }]}>Un instant...</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!data) {
    const loginHref = { pathname: "/auth/login", params: { redirect: `/guestbook/${clientId}/reveal` } } as any;
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.emoji}>💌</Text>
          <Text style={styles.brand}>CINÉMARIÉS</Text>
          <Text style={styles.title}>Votre livre d&apos;or</Text>
          {!user ? (
            <>
              <Text style={styles.subtle}>Connectez-vous à votre espace Mariés pour découvrir les vœux de vos invités. Aucun code n&apos;est nécessaire.</Text>
              <TouchableOpacity style={styles.revealBtn} onPress={() => router.push(loginHref)} testID="reveal-login">
                <Ionicons name="log-in-outline" size={18} color="#0A0A0A" />
                <Text style={styles.revealBtnText}>Se connecter à mon espace</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.push({ pathname: "/auth/register", params: { redirect: `/guestbook/${clientId}/reveal` } } as any)} style={{ marginTop: 14 }} testID="reveal-register">
                <Text style={{ color: colors.gold, fontSize: 13 }}>Pas encore de compte ? Créer mon compte Mariés</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.subtle}>{error || "Votre compte n'est pas encore relié à ce mariage."}</Text>
              <Text style={[styles.subtle, { fontSize: 12 }]}>Connecté en tant que {user.email}. Demandez à CINÉMARIÉS de relier votre compte à votre mariage.</Text>
              <TouchableOpacity style={styles.revealBtn} onPress={() => router.replace("/(tabs)/profile")} testID="reveal-go-profile">
                <Ionicons name="person-outline" size={18} color="#0A0A0A" />
                <Text style={styles.revealBtnText}>Aller à mon espace</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: 60 }}>
        <Animated.View style={{ opacity: introAnim, alignItems: "center", marginBottom: spacing.xl }}>
          <Text style={styles.emojiBig}>💌</Text>
          <Text style={styles.brand}>CINÉMARIÉS</Text>
          <Text style={styles.revealTitle}>Vos {data.count} messages d'amour</Text>
          <Text style={styles.subtle}>{data.wedding_name}</Text>
        </Animated.View>

        {data.items.slice(0, revealedCount).map((e, idx) => (
          <RevealCard key={e.id} entry={e} index={idx} />
        ))}

        {revealedCount < data.count ? (
          <View style={styles.moreLoading}>
            <ActivityIndicator color={colors.gold} size="small" />
            <Text style={styles.subtle}>
              {revealedCount}/{data.count} messages révélés...
            </Text>
          </View>
        ) : (
          <View style={styles.doneBanner}>
            <Ionicons name="heart" size={22} color={colors.gold} />
            <Text style={styles.doneText}>
              {data.count > 0
                ? `${data.count} personnes vous aiment 💕`
                : "Aucun message pour le moment"}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function RevealCard({ entry, index }: { entry: Entry; index: number }) {
  const anim = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(anim, {
      toValue: 1,
      friction: 8,
      tension: 30,
      useNativeDriver: true,
    }).start();
  }, [anim]);

  return (
    <Animated.View
      style={[
        styles.msgCard,
        {
          opacity: anim,
          transform: [
            {
              translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }),
            },
            {
              scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.95, 1] }),
            },
          ],
        },
      ]}
    >
      <View style={styles.msgHeader}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{(entry.guest_name || "?").charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1, marginLeft: 12 }}>
          <Text style={styles.msgAuthor}>{entry.guest_name || "Un invité"}</Text>
          <Text style={styles.msgDate}>
            {new Date(entry.created_at).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}
          </Text>
        </View>
      </View>
      {entry.message_text ? <Text style={styles.msgText}>{entry.message_text}</Text> : null}
      {entry.media_url && entry.media_type === "video" && Platform.OS === "web" ? (
        // @ts-ignore
        <video src={entry.media_url} controls style={{ width: "100%", maxHeight: 400, borderRadius: 12, marginTop: 12 }} />
      ) : null}
      {entry.media_url && entry.media_type === "audio" && Platform.OS === "web" ? (
        // @ts-ignore
        <audio src={entry.media_url} controls style={{ width: "100%", marginTop: 12 }} />
      ) : null}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl },

  emoji: { fontSize: 60, marginBottom: 12 },
  emojiBig: { fontSize: 72 },
  brand: { color: colors.gold, fontSize: 12, fontWeight: "800", letterSpacing: 4, marginBottom: 8 },
  title: { color: colors.ivory, fontSize: 30, fontWeight: "800", marginBottom: 12, textAlign: "center" },
  subtle: { color: colors.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20 },
  revealTitle: {
    color: colors.gold,
    fontSize: 24,
    fontWeight: "800",
    marginTop: 8,
    marginBottom: 6,
    textAlign: "center",
    fontStyle: "italic",
  },

  revealBtn: {
    marginTop: spacing.lg,
    backgroundColor: colors.gold,
    paddingHorizontal: 32,
    paddingVertical: 16,
    borderRadius: radii.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  revealBtnText: { color: "#0A0A0A", fontWeight: "800", fontSize: 15 },

  msgCard: {
    padding: spacing.lg,
    marginBottom: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.20)",
  },
  msgHeader: { flexDirection: "row", alignItems: "center", marginBottom: 8 },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#0A0A0A", fontSize: 18, fontWeight: "800" },
  msgAuthor: { color: colors.gold, fontSize: 15, fontWeight: "700" },
  msgDate: { color: colors.textSecondary, fontSize: 11 },
  msgText: { color: colors.ivory, fontSize: 15, lineHeight: 22 },

  moreLoading: { flexDirection: "row", alignItems: "center", gap: 8, justifyContent: "center", marginTop: spacing.md },
  doneBanner: {
    marginTop: spacing.xl,
    alignItems: "center",
    padding: spacing.lg,
    borderRadius: radii.md,
    backgroundColor: "rgba(212,175,55,0.05)",
    borderWidth: 1,
    borderColor: colors.gold,
  },
  doneText: { color: colors.gold, fontSize: 15, fontWeight: "700", marginTop: 8 },
});

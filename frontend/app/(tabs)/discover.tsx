import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ImageBackground,
  RefreshControl,
  ActivityIndicator,
  Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { useAuth } from "@/src/auth/AuthContext";

type ShowcaseVideo = {
  id: string;
  title: string;
  description: string;
  category: string;
  poster_url: string;
  hero_url?: string | null;
  trailer_url: string;
  full_url?: string | null;
  duration_minutes: number;
  is_featured: boolean;
  is_top_france: boolean;
  is_showcase: boolean;
};

type Row = { category: string; videos: ShowcaseVideo[] };

type ShowcaseResponse = {
  is_authenticated: boolean;
  featured: ShowcaseVideo[];
  rows: Row[];
  total: number;
};

const { width } = Dimensions.get("window");

export default function DiscoverScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [data, setData] = useState<ShowcaseResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<ShowcaseResponse>("/videos/showcase", { auth: !!user });
      setData(d);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.gold} />
      </View>
    );
  }

  const hero = data?.featured?.[0] || data?.rows?.[0]?.videos?.[0] || null;
  const total = data?.total || 0;

  return (
    <View style={styles.root} testID="discover-screen">
      <ScrollView
        showsVerticalScrollIndicator={false}
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
        {/* HERO */}
        {hero ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push(`/video/${hero.id}`)}
            testID="discover-hero"
          >
            <ImageBackground
              source={{ uri: hero.hero_url || hero.poster_url }}
              style={styles.hero}
              imageStyle={{ resizeMode: "cover" }}
            >
              <LinearGradient
                colors={["rgba(10,10,10,0)", "rgba(10,10,10,0.55)", "rgba(10,10,10,1)"]}
                locations={[0, 0.55, 1]}
                style={StyleSheet.absoluteFillObject}
              />
              <SafeAreaView edges={["top"]} style={styles.heroTop}>
                <View style={styles.brandRow}>
                  <View>
                    <Text style={styles.brandTxt}>DÉCOUVRIR</Text>
                    <Text style={styles.brandTagline}>Le cinéma de vos plus beaux jours</Text>
                  </View>
                  <View style={styles.badge}>
                    <Ionicons name="sparkles" size={12} color={colors.gold} />
                    <Text style={styles.badgeText}>DÉMOS</Text>
                  </View>
                </View>
              </SafeAreaView>
              <View style={styles.heroContent}>
                <View style={styles.heroBadgeRow}>
                  <Ionicons name="play-circle" size={14} color={colors.gold} />
                  <Text style={styles.heroBadgeText}>Accès libre · {total} vidéo{total > 1 ? "s" : ""}</Text>
                </View>
                <Text style={styles.heroTitle} numberOfLines={2}>
                  {hero.title}
                </Text>
                {!!hero.description && (
                  <Text style={styles.heroSub} numberOfLines={2}>
                    {hero.description}
                  </Text>
                )}
                <View style={styles.heroBtns}>
                  <TouchableOpacity
                    style={styles.playBtn}
                    onPress={() => router.push(`/video/${hero.id}`)}
                    testID="discover-hero-play"
                  >
                    <Ionicons name="play" size={18} color="#0A0A0A" />
                    <Text style={styles.playTxt}>Regarder</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.infoBtn}
                    onPress={() => router.push(`/video/${hero.id}`)}
                  >
                    <Ionicons name="information-circle-outline" size={18} color={colors.ivory} />
                    <Text style={styles.infoTxt}>Plus d&apos;infos</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ImageBackground>
          </TouchableOpacity>
        ) : (
          <SafeAreaView edges={["top"]} style={styles.emptyHero}>
            <Ionicons name="film-outline" size={56} color={colors.gold} />
            <Text style={styles.emptyHeroTitle}>Nos démos arrivent bientôt</Text>
            <Text style={styles.emptyHeroSub}>
              Les vidéos de démonstration seront publiées prochainement par le studio.
            </Text>
          </SafeAreaView>
        )}

        {/* CTA inscription si non connecté */}
        {!user && total > 0 && (
          <View style={styles.signupBand}>
            <View style={styles.signupBandIcon}>
              <Ionicons name="person-add" size={18} color="#0A0A0A" />
            </View>
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.signupTitle}>Compte gratuit pour regarder</Text>
              <Text style={styles.signupSub}>Inscription en 30 secondes, sans engagement</Text>
            </View>
            <TouchableOpacity
              style={styles.signupBtn}
              onPress={() => router.push("/auth/register")}
              testID="discover-signup-btn"
            >
              <Text style={styles.signupBtnTxt}>S&apos;inscrire</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ROWS */}
        {(data?.rows || []).map((row) => (
          <Row key={row.category} title={row.category} videos={row.videos} router={router} />
        ))}

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function Row({
  title,
  videos,
  router,
}: {
  title: string;
  videos: ShowcaseVideo[];
  router: ReturnType<typeof useRouter>;
}) {
  if (!videos?.length) return null;
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{title}</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: spacing.md }}
      >
        {videos.map((v) => (
          <TouchableOpacity
            key={v.id}
            style={styles.card}
            activeOpacity={0.85}
            onPress={() => router.push(`/video/${v.id}`)}
            testID={`discover-card-${v.id}`}
          >
            <Image source={{ uri: v.poster_url }} style={styles.cardImg} contentFit="cover" />
            <View style={styles.cardPlay}>
              <Ionicons name="play-circle" size={32} color="rgba(255,255,255,0.95)" />
            </View>
            {v.is_top_france && (
              <View style={styles.cardBadge}>
                <Text style={styles.cardBadgeTxt}>N°1</Text>
              </View>
            )}
            <View style={styles.cardFooter}>
              <Text style={styles.cardTitle} numberOfLines={1}>
                {v.title}
              </Text>
              <Text style={styles.cardMeta}>
                {v.duration_minutes > 0 ? `${v.duration_minutes} min` : "Démo"}
              </Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },

  hero: { width, height: width * 1.15, justifyContent: "space-between" },
  heroTop: { paddingHorizontal: spacing.md, paddingTop: spacing.xs },
  brandRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  brandTxt: { color: colors.gold, fontSize: 22, fontWeight: "800", letterSpacing: 3 },
  brandTagline: { color: colors.ivory, fontSize: 11, opacity: 0.7, marginTop: 2, letterSpacing: 1 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(212,175,55,0.18)",
    borderColor: colors.gold,
    borderWidth: 1,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
  },
  badgeText: { color: colors.gold, fontSize: 10, fontWeight: "800", marginLeft: 4, letterSpacing: 1 },

  heroContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  heroBadgeRow: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  heroBadgeText: { color: colors.gold, fontSize: 12, marginLeft: 6, fontWeight: "600", letterSpacing: 0.5 },
  heroTitle: { color: colors.ivory, fontSize: 30, fontWeight: "900", lineHeight: 34 },
  heroSub: { color: colors.textSecondary, fontSize: 13, marginTop: 8, lineHeight: 18 },
  heroBtns: { flexDirection: "row", gap: 10, marginTop: 16 },
  playBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.gold,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: radii.sm,
    gap: 6,
  },
  playTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 14 },
  infoBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingHorizontal: 18,
    paddingVertical: 11,
    borderRadius: radii.sm,
    gap: 6,
  },
  infoTxt: { color: colors.ivory, fontWeight: "600", fontSize: 14 },

  emptyHero: { paddingVertical: 80, alignItems: "center", paddingHorizontal: spacing.lg },
  emptyHeroTitle: { color: colors.ivory, fontSize: 18, fontWeight: "700", marginTop: 16 },
  emptyHeroSub: { color: colors.textSecondary, fontSize: 13, textAlign: "center", marginTop: 6 },

  signupBand: {
    flexDirection: "row",
    alignItems: "center",
    margin: spacing.md,
    padding: spacing.md,
    backgroundColor: "rgba(212,175,55,0.08)",
    borderRadius: radii.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
  },
  signupBandIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  signupTitle: { color: colors.ivory, fontSize: 14, fontWeight: "700" },
  signupSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  signupBtn: {
    backgroundColor: colors.gold,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: radii.sm,
  },
  signupBtnTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 12 },

  row: { marginTop: spacing.lg },
  rowTitle: {
    color: colors.ivory,
    fontSize: 17,
    fontWeight: "800",
    paddingHorizontal: spacing.md,
    marginBottom: 10,
    letterSpacing: 0.3,
  },
  card: {
    width: 150,
    marginRight: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: radii.md,
    overflow: "hidden",
  },
  cardImg: { width: 150, height: 200, backgroundColor: "rgba(255,255,255,0.06)" },
  cardPlay: {
    position: "absolute",
    top: 80,
    left: 0,
    right: 0,
    alignItems: "center",
    opacity: 0.85,
  },
  cardBadge: {
    position: "absolute",
    top: 8,
    left: 8,
    backgroundColor: colors.gold,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  cardBadgeTxt: { color: "#0A0A0A", fontSize: 10, fontWeight: "900", letterSpacing: 0.5 },
  cardFooter: { paddingHorizontal: 10, paddingVertical: 8 },
  cardTitle: { color: colors.ivory, fontSize: 13, fontWeight: "700" },
  cardMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
});

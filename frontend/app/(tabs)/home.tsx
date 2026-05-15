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

type Video = {
  id: string;
  title: string;
  description: string;
  category: string;
  poster_url: string;
  hero_url?: string;
  duration_minutes: number;
  is_top_france?: boolean;
  is_featured?: boolean;
};

type Catalog = {
  featured: Video[];
  rows: Record<string, Video[]>;
};

const { width } = Dimensions.get("window");

export default function HomeScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await api<Catalog>("/videos/public", { auth: false });
      setCatalog(d);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.gold} size="large" />
      </View>
    );
  }

  const hero = catalog?.featured?.[0];
  const rowOrder = ["À l'affiche", "Cérémonies", "Soirées", "Best Of"];

  return (
    <View style={styles.root} testID="home-screen">
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
        {hero && (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => router.push(`/video/${hero.id}`)}
            testID="hero-banner"
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
                    <Text style={styles.brandTxt}>CINÉMARIÉS</Text>
                    <Text style={styles.brandTagline}>Le cinéma de votre plus beau jour</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => router.push("/unlock")}
                    style={styles.iconBtn}
                    testID="open-unlock-btn"
                  >
                    <Ionicons name="key-outline" size={22} color={colors.gold} />
                  </TouchableOpacity>
                </View>
              </SafeAreaView>

              <View style={styles.heroContent}>
                {hero.is_top_france && (
                  <View style={styles.topBadge} testID="top-france-badge">
                    <Text style={styles.topBadgeText}>N°1 EN FRANCE</Text>
                  </View>
                )}
                <Text style={styles.heroTitle} numberOfLines={2}>
                  {hero.title}
                </Text>
                <Text style={styles.heroSub} numberOfLines={2}>
                  {hero.description}
                </Text>
                <View style={styles.heroBtns}>
                  <TouchableOpacity
                    style={styles.playBtn}
                    onPress={() => router.push(`/video/${hero.id}`)}
                    testID="hero-play-btn"
                  >
                    <Ionicons name="play" size={18} color="#0A0A0A" />
                    <Text style={styles.playTxt}>Lecture</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.infoBtn}
                    onPress={() => router.push(`/video/${hero.id}`)}
                    testID="hero-info-btn"
                  >
                    <Ionicons name="information-circle-outline" size={18} color={colors.ivory} />
                    <Text style={styles.infoTxt}>Plus d&apos;infos</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ImageBackground>
          </TouchableOpacity>
        )}

        {/* UNLOCK BAND */}
        <TouchableOpacity
          style={styles.unlockBand}
          onPress={() => router.push("/unlock")}
          testID="unlock-band"
        >
          <View style={styles.unlockBandLeft}>
            <Ionicons name="lock-closed" size={18} color={colors.gold} />
            <View style={{ marginLeft: 12 }}>
              <Text style={styles.unlockTitle}>Débloquez votre film de mariage</Text>
              <Text style={styles.unlockSub}>Entrez votre code client unique</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.gold} />
        </TouchableOpacity>

        {/* ROWS */}
        {rowOrder
          .filter((cat) => catalog?.rows?.[cat]?.length)
          .map((cat) => (
            <Row key={cat} title={cat} videos={catalog!.rows[cat]} router={router} />
          ))}

        <View style={{ height: 40 }} />
      </ScrollView>

      {!user && (
        <View style={styles.bottomCTA}>
          <TouchableOpacity
            style={styles.ctaBtn}
            onPress={() => router.push("/auth/login")}
            testID="login-cta"
          >
            <Text style={styles.ctaTxt}>Se connecter</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function Row({
  title,
  videos,
  router,
}: {
  title: string;
  videos: Video[];
  router: ReturnType<typeof useRouter>;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.md }}>
        {videos.map((v, idx) => (
          <TouchableOpacity
            key={v.id}
            style={styles.poster}
            activeOpacity={0.85}
            onPress={() => router.push(`/video/${v.id}`)}
            testID={`poster-${v.id}`}
          >
            <Image source={{ uri: v.poster_url }} style={styles.posterImg} contentFit="cover" />
            {v.is_top_france && (
              <View style={styles.posterBadge}>
                <Text style={styles.posterBadgeTxt}>N°1</Text>
              </View>
            )}
            <View style={styles.posterFooter}>
              <Text style={styles.posterTitle} numberOfLines={1}>
                {v.title}
              </Text>
              <Text style={styles.posterMeta}>{v.duration_minutes} min</Text>
            </View>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  hero: { width, height: width * 1.15, justifyContent: "flex-end" },
  heroTop: { position: "absolute", top: 0, left: 0, right: 0 },
  brandRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  brandTxt: { color: colors.gold, fontSize: 20, letterSpacing: 4, fontWeight: "700" },
  brandTagline: { color: colors.ivory, fontSize: 10, letterSpacing: 2, fontStyle: "italic", marginTop: 2, opacity: 0.85 },
  brandAccent: { color: colors.gold, fontWeight: "700" },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.4)",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  heroContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  topBadge: {
    alignSelf: "flex-start",
    backgroundColor: colors.wine,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: spacing.sm,
  },
  topBadgeText: { color: colors.ivory, fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  heroTitle: { color: colors.ivory, fontSize: 34, fontWeight: "700", letterSpacing: -0.5 },
  heroSub: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.xs, marginBottom: spacing.md },
  heroBtns: { flexDirection: "row", gap: 12 },
  playBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.gold,
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: radii.sm,
    gap: 8,
  },
  playTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15 },
  infoBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,240,0.12)",
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderRadius: radii.sm,
    gap: 8,
  },
  infoTxt: { color: colors.ivory, fontWeight: "600", fontSize: 14 },
  unlockBand: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unlockBandLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  unlockTitle: { color: colors.ivory, fontWeight: "600", fontSize: 14 },
  unlockSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  row: { marginTop: spacing.lg },
  rowTitle: {
    color: colors.ivory,
    fontSize: 18,
    fontWeight: "600",
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  poster: { width: 130, marginRight: 10 },
  posterImg: { width: 130, height: 195, borderRadius: radii.sm, backgroundColor: colors.surfaceElevated },
  posterBadge: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: colors.wine,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  posterBadgeTxt: { color: colors.ivory, fontWeight: "700", fontSize: 10, letterSpacing: 0.5 },
  posterFooter: { paddingTop: 6 },
  posterTitle: { color: colors.ivory, fontSize: 13, fontWeight: "600" },
  posterMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  bottomCTA: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: spacing.md,
    paddingBottom: spacing.lg,
    backgroundColor: "rgba(10,10,10,0.95)",
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
  },
  ctaBtn: {
    backgroundColor: colors.gold,
    paddingVertical: 14,
    borderRadius: radii.sm,
    alignItems: "center",
  },
  ctaTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15, letterSpacing: 0.5 },
});

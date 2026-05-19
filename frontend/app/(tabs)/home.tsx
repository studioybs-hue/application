import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ImageBackground,
  RefreshControl, ActivityIndicator, Dimensions,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { useAuth } from "@/src/auth/AuthContext";

type Wedding = {
  client_id: string;
  client_name: string;
  poster_url: string;
  hero_url: string;
  description: string;
  is_featured: boolean;
  is_top_france: boolean;
  video_count: number;
  total_minutes: number;
};

type Catalog = {
  featured: Wedding[];
  weddings: Wedding[];
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
      const d = await api<Catalog>("/weddings/public", { auth: false });
      setCatalog(d);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return <View style={styles.loading}><ActivityIndicator color={colors.gold} size="large" /></View>;
  }

  const hero = catalog?.featured?.[0];
  const topFrance = catalog?.weddings?.filter((w) => w.is_top_france) || [];
  const featured = catalog?.weddings?.filter((w) => w.is_featured) || [];
  const recent = catalog?.weddings?.filter((w) => !w.is_featured && !w.is_top_france) || [];

  return (
    <View style={styles.root} testID="home-screen">
      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />
        }
      >
        {hero && (
          <TouchableOpacity activeOpacity={0.9} onPress={() => router.push(`/wedding/${hero.client_id}`)} testID="hero-banner">
            <ImageBackground source={{ uri: hero.hero_url || hero.poster_url }} style={styles.hero} imageStyle={{ resizeMode: "cover" }}>
              <LinearGradient colors={["rgba(10,10,10,0)", "rgba(10,10,10,0.55)", "rgba(10,10,10,1)"]} locations={[0, 0.55, 1]} style={StyleSheet.absoluteFillObject} />
              <SafeAreaView edges={["top"]} style={styles.heroTop}>
                <View style={styles.brandRow}>
                  <View>
                    <Text style={styles.brandTxt}>CINÉMARIÉS</Text>
                    <Text style={styles.brandTagline}>Le cinéma de votre plus beau jour</Text>
                  </View>
                  <TouchableOpacity onPress={() => router.push("/unlock")} style={styles.iconBtn} testID="open-unlock-btn">
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
                <Text style={styles.heroTitle} numberOfLines={2}>{hero.client_name}</Text>
                <Text style={styles.heroSub} numberOfLines={2}>{hero.description || `${hero.video_count} vidéo${hero.video_count > 1 ? "s" : ""} · ${hero.total_minutes} min`}</Text>
                <View style={styles.heroBtns}>
                  <TouchableOpacity style={styles.playBtn} onPress={() => router.push(`/wedding/${hero.client_id}`)} testID="hero-play-btn">
                    <Ionicons name="lock-closed" size={16} color="#0A0A0A" />
                    <Text style={styles.playTxt}>Entrer</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.infoBtn} onPress={() => router.push(`/wedding/${hero.client_id}`)} testID="hero-info-btn">
                    <Ionicons name="information-circle-outline" size={18} color={colors.ivory} />
                    <Text style={styles.infoTxt}>Plus d&apos;infos</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ImageBackground>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.unlockBand} onPress={() => router.push("/unlock")} testID="unlock-band">
          <View style={styles.unlockBandLeft}>
            <Ionicons name="lock-closed" size={18} color={colors.gold} />
            <View style={{ marginLeft: 12 }}>
              <Text style={styles.unlockTitle}>Débloquez votre film de mariage</Text>
              <Text style={styles.unlockSub}>Entrez votre code client unique</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color={colors.gold} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.hostBand} onPress={() => router.push("/host")} testID="host-band">
          <View style={styles.unlockBandLeft}>
            <Ionicons name="heart" size={20} color="#0A0A0A" />
            <View style={{ marginLeft: 12 }}>
              <Text style={styles.hostTitle}>Hébergez votre mariage</Text>
              <Text style={styles.hostSub}>Frais unique 90€ à vie — paiement sécurisé</Text>
            </View>
          </View>
          <Ionicons name="chevron-forward" size={20} color="#0A0A0A" />
        </TouchableOpacity>

        {topFrance.length > 0 && <Row title="N°1 en France" weddings={topFrance} router={router} />}
        {featured.length > 0 && <Row title="À l'affiche" weddings={featured} router={router} />}
        {recent.length > 0 && <Row title="Nos derniers mariages" weddings={recent} router={router} />}

        <View style={{ height: 40 }} />
      </ScrollView>

      {!user && (
        <View style={styles.bottomCTA}>
          <TouchableOpacity style={styles.ctaBtn} onPress={() => router.push("/auth/login")} testID="login-cta">
            <Text style={styles.ctaTxt}>Se connecter</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function Row({ title, weddings, router }: { title: string; weddings: Wedding[]; router: ReturnType<typeof useRouter> }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>{title}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: spacing.md }}>
        {weddings.map((w) => (
          <TouchableOpacity
            key={w.client_id}
            style={styles.poster}
            activeOpacity={0.85}
            onPress={() => router.push(`/wedding/${w.client_id}`)}
            testID={`poster-${w.client_id}`}
          >
            <Image source={{ uri: w.poster_url }} style={styles.posterImg} contentFit="cover" />
            <View style={styles.posterOverlay}>
              <Ionicons name="lock-closed" size={14} color={colors.gold} />
            </View>
            {w.is_top_france && (
              <View style={styles.posterBadge}>
                <Text style={styles.posterBadgeTxt}>N°1</Text>
              </View>
            )}
            <View style={styles.posterFooter}>
              <Text style={styles.posterTitle} numberOfLines={1}>{w.client_name}</Text>
              <Text style={styles.posterMeta}>{w.video_count} vidéo{w.video_count > 1 ? "s" : ""} · {w.total_minutes} min</Text>
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
  brandRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  brandTxt: { color: colors.gold, fontSize: 20, letterSpacing: 4, fontWeight: "700" },
  brandTagline: { color: colors.ivory, fontSize: 10, letterSpacing: 2, fontStyle: "italic", marginTop: 2, opacity: 0.85 },
  iconBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: "rgba(212,175,55,0.4)", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.4)" },
  heroContent: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg },
  topBadge: { alignSelf: "flex-start", backgroundColor: colors.wine, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, marginBottom: spacing.sm },
  topBadgeText: { color: colors.ivory, fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  heroTitle: { color: colors.ivory, fontSize: 34, fontWeight: "700", letterSpacing: -0.5 },
  heroSub: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.xs, marginBottom: spacing.md },
  heroBtns: { flexDirection: "row", gap: 12 },
  playBtn: { flexDirection: "row", alignItems: "center", backgroundColor: colors.gold, paddingHorizontal: 22, paddingVertical: 12, borderRadius: radii.sm, gap: 8 },
  playTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15 },
  infoBtn: { flexDirection: "row", alignItems: "center", backgroundColor: "rgba(255,255,240,0.12)", paddingHorizontal: 18, paddingVertical: 12, borderRadius: radii.sm, gap: 8 },
  infoTxt: { color: colors.ivory, fontWeight: "600", fontSize: 14 },
  unlockBand: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: spacing.md, marginTop: spacing.md, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  unlockBandLeft: { flexDirection: "row", alignItems: "center", flex: 1 },
  unlockTitle: { color: colors.ivory, fontWeight: "600", fontSize: 14 },
  unlockSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  hostBand: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginHorizontal: spacing.md, marginTop: 10, padding: spacing.md, backgroundColor: colors.gold, borderRadius: radii.md },
  hostTitle: { color: "#0A0A0A", fontWeight: "800", fontSize: 14 },
  hostSub: { color: "rgba(0,0,0,0.7)", fontSize: 11, marginTop: 2, fontWeight: "600" },
  row: { marginTop: spacing.lg },
  rowTitle: { color: colors.ivory, fontSize: 18, fontWeight: "600", paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  poster: { width: 130, marginRight: 10 },
  posterImg: { width: 130, height: 195, borderRadius: radii.sm, backgroundColor: colors.surfaceElevated },
  posterOverlay: { position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: 13, backgroundColor: "rgba(0,0,0,0.7)", alignItems: "center", justifyContent: "center" },
  posterBadge: { position: "absolute", top: 6, left: 6, backgroundColor: colors.wine, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },
  posterBadgeTxt: { color: colors.ivory, fontWeight: "700", fontSize: 10, letterSpacing: 0.5 },
  posterFooter: { paddingTop: 6 },
  posterTitle: { color: colors.ivory, fontSize: 13, fontWeight: "600" },
  posterMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  bottomCTA: { position: "absolute", bottom: 0, left: 0, right: 0, padding: spacing.md, paddingBottom: spacing.lg, backgroundColor: "rgba(10,10,10,0.95)", borderTopWidth: 0.5, borderTopColor: colors.border },
  ctaBtn: { backgroundColor: colors.gold, paddingVertical: 14, borderRadius: radii.sm, alignItems: "center" },
  ctaTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15, letterSpacing: 0.5 },
});

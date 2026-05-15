import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Platform,
  Linking,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { useAuth } from "@/src/auth/AuthContext";

export default function SubscriptionScreen() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const params = useLocalSearchParams<{ status?: string; session_id?: string }>();
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (params.status === "success") {
      (async () => {
        setVerifying(true);
        try {
          await api(`/billing/status?session_id=${params.session_id || ""}`);
          await refresh();
          Alert.alert("✓ Bienvenue Premium", "Votre abonnement est activé !");
        } catch (e) {
          // ignore
        } finally {
          setVerifying(false);
        }
      })();
    }
  }, [params.status, params.session_id, refresh]);

  const subscribe = async () => {
    if (!user) {
      router.push("/auth/login");
      return;
    }
    setLoading(true);
    try {
      const r = await api<{ url: string }>("/billing/checkout", {
        method: "POST",
        body: {},
      });
      if (Platform.OS === "web") {
        // Linking is more reliable on web
        window.location.href = r.url;
      } else {
        await WebBrowser.openBrowserAsync(r.url);
        // After return, refresh status
        await refresh();
      }
    } catch (e: any) {
      Alert.alert("Erreur", e.message || "Impossible de démarrer le paiement");
    } finally {
      setLoading(false);
    }
  };

  const features = [
    { icon: "infinite", text: "Accès illimité au catalogue complet" },
    { icon: "tv", text: "Chromecast & version TV (à venir)" },
    { icon: "download", text: "Téléchargement hors-ligne (à venir)" },
    { icon: "star", text: "Qualité 4K et son immersif" },
    { icon: "shield-checkmark", text: "Sans publicité, sans engagement" },
  ];

  return (
    <View style={styles.root}>
      <LinearGradient colors={[colors.burgundy, colors.bg]} style={StyleSheet.absoluteFillObject} />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="subscription-back">
              <Ionicons name="close" size={28} color={colors.ivory} />
            </TouchableOpacity>
          </View>

          <View style={styles.hero}>
            <View style={styles.iconBubble}>
              <Ionicons name="star" size={32} color={colors.gold} />
            </View>
            <Text style={styles.title}>Wedding Stream Premium</Text>
            <Text style={styles.subtitle}>
              La plateforme de streaming dédiée aux plus beaux mariages.
            </Text>
          </View>

          <View style={styles.priceCard}>
            <Text style={styles.priceBig}>
              1,99€ <Text style={styles.priceSmall}>/ mois</Text>
            </Text>
            <Text style={styles.priceNote}>Sans engagement, résiliable à tout moment</Text>
          </View>

          <View style={styles.featureList}>
            {features.map((f) => (
              <View key={f.text} style={styles.featureRow}>
                <View style={styles.featureIcon}>
                  <Ionicons name={f.icon as any} size={18} color={colors.gold} />
                </View>
                <Text style={styles.featureTxt}>{f.text}</Text>
              </View>
            ))}
          </View>

          {user?.is_subscribed ? (
            <View style={styles.activeCard} testID="subscription-active">
              <Ionicons name="checkmark-circle" size={24} color={colors.success} />
              <Text style={styles.activeTxt}>Vous êtes Premium</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.cta}
              onPress={subscribe}
              disabled={loading || verifying}
              testID="subscribe-btn"
            >
              {loading || verifying ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <>
                  <Text style={styles.ctaTxt}>S&apos;abonner — 1,99€/mois</Text>
                  <Ionicons name="arrow-forward" size={18} color="#0A0A0A" />
                </>
              )}
            </TouchableOpacity>
          )}

          <View style={styles.legal}>
            <Text style={styles.legalTxt}>
              Paiement sécurisé par Stripe. Vous serez redirigé vers une page de paiement sécurisée.
            </Text>
            <TouchableOpacity onPress={() => Linking.openURL("https://stripe.com/fr/legal")}>
              <Text style={styles.legalLink}>Conditions générales</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  header: { flexDirection: "row", justifyContent: "flex-end" },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  hero: { alignItems: "center", marginTop: spacing.md, marginBottom: spacing.lg },
  iconBubble: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "rgba(212,175,55,0.1)",
    borderWidth: 1.5,
    borderColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.md,
  },
  title: { color: colors.ivory, fontSize: 28, fontWeight: "700", textAlign: "center" },
  subtitle: { color: colors.textSecondary, fontSize: 14, textAlign: "center", marginTop: 8, paddingHorizontal: spacing.lg },
  priceCard: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: "center",
    marginVertical: spacing.lg,
  },
  priceBig: { color: colors.gold, fontSize: 48, fontWeight: "800", letterSpacing: -1 },
  priceSmall: { color: colors.ivory, fontSize: 18, fontWeight: "400" },
  priceNote: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },
  featureList: { marginBottom: spacing.lg },
  featureRow: { flexDirection: "row", alignItems: "center", paddingVertical: 10 },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(212,175,55,0.1)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: spacing.md,
  },
  featureTxt: { color: colors.ivory, fontSize: 14, flex: 1 },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    backgroundColor: colors.gold,
    paddingVertical: 16,
    borderRadius: radii.sm,
  },
  ctaTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 16, letterSpacing: 0.3 },
  activeCard: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    paddingVertical: 16,
    backgroundColor: "rgba(46,125,50,0.15)",
    borderWidth: 1,
    borderColor: colors.success,
    borderRadius: radii.sm,
  },
  activeTxt: { color: colors.ivory, fontWeight: "700", fontSize: 15 },
  legal: { alignItems: "center", marginTop: spacing.lg, paddingHorizontal: spacing.md },
  legalTxt: { color: colors.textSecondary, fontSize: 11, textAlign: "center", lineHeight: 16 },
  legalLink: { color: colors.gold, fontSize: 12, marginTop: 6 },
});

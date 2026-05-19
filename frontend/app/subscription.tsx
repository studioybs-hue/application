import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
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
import { showAlert, confirmAction } from "@/src/utils/dialog";

export default function SubscriptionScreen() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const params = useLocalSearchParams<{ status?: string; session_id?: string; tier?: string }>();
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [selectedTier, setSelectedTier] = useState<"basic" | "unlimited">(
    (params.tier as any) === "unlimited" ? "unlimited" : "basic"
  );

  useEffect(() => {
    if (params.status === "success") {
      (async () => {
        setVerifying(true);
        try {
          await api(`/billing/status?session_id=${params.session_id || ""}`);
          await refresh();
          showAlert("✓ Bienvenue Premium", "Votre abonnement est activé !");
        } catch (e) {
          // ignore
        } finally {
          setVerifying(false);
        }
      })();
    } else if (params.status === "cancel") {
      showAlert("Paiement annulé", "Vous n'avez pas été débité. Vous pouvez réessayer à tout moment.");
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
        body: { tier: selectedTier },
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
      showAlert("Erreur", e.message || "Impossible de démarrer le paiement");
    } finally {
      setLoading(false);
    }
  };

  const cancelSub = () => {
    confirmAction(
      "Résilier l'abonnement",
      "Votre abonnement sera résilié à la fin de la période en cours. Vous garderez l'accès Premium jusqu'à cette date.",
      async () => {
        setCanceling(true);
        try {
          await api("/billing/cancel", { method: "POST", body: {} });
          await refresh();
          showAlert("Abonnement résilié", "Votre abonnement sera résilié à la fin de la période en cours.");
        } catch (e: any) {
          showAlert("Erreur", e.message || "Impossible de résilier l'abonnement");
        } finally {
          setCanceling(false);
        }
      },
      { confirmText: "Résilier", cancelText: "Garder", destructive: true }
    );
  };

  const features = [
    { icon: "infinite", text: "Accès illimité au catalogue complet" },
    { icon: "tv", text: "Chromecast (Chrome desktop) & version TV" },
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
            <Text style={styles.title}>CINÉMARIÉS Premium</Text>
            <Text style={styles.subtitle}>
              Le cinéma de votre plus beau jour, partout avec vous.
            </Text>
          </View>

          <View style={styles.tiersWrap}>
            <TouchableOpacity
              style={[styles.tierCard, selectedTier === "basic" && styles.tierCardActive]}
              onPress={() => setSelectedTier("basic")}
              testID="tier-basic"
              activeOpacity={0.85}
            >
              <View style={styles.tierHeader}>
                <Ionicons name="star" size={20} color={selectedTier === "basic" ? colors.gold : colors.textSecondary} />
                <Text style={[styles.tierName, selectedTier === "basic" && { color: colors.gold }]}>Premium</Text>
                {selectedTier === "basic" && <Ionicons name="checkmark-circle" size={20} color={colors.gold} style={{ marginLeft: "auto" }} />}
              </View>
              <Text style={styles.tierPrice}>1,99€<Text style={styles.tierUnit}> /mois</Text></Text>
              <Text style={styles.tierBullet}>• Jusqu'à 3 codes d'invitation</Text>
              <Text style={styles.tierBullet}>• 1 code = 1 appareil</Text>
              <Text style={styles.tierBullet}>• Sans engagement</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tierCard, selectedTier === "unlimited" && styles.tierCardActive]}
              onPress={() => setSelectedTier("unlimited")}
              testID="tier-unlimited"
              activeOpacity={0.85}
            >
              <View style={styles.tierHeader}>
                <Ionicons name="infinite" size={20} color={selectedTier === "unlimited" ? colors.gold : colors.textSecondary} />
                <Text style={[styles.tierName, selectedTier === "unlimited" && { color: colors.gold }]}>Premium Illimité</Text>
                {selectedTier === "unlimited" && <Ionicons name="checkmark-circle" size={20} color={colors.gold} style={{ marginLeft: "auto" }} />}
              </View>
              <View style={styles.bestBadge}><Text style={styles.bestBadgeTxt}>RECOMMANDÉ</Text></View>
              <Text style={styles.tierPrice}>2,30€<Text style={styles.tierUnit}> /mois</Text></Text>
              <Text style={styles.tierBullet}>• Codes ILLIMITÉS</Text>
              <Text style={styles.tierBullet}>• 1 code = 1 appareil (sécurité)</Text>
              <Text style={styles.tierBullet}>• Invitez tous vos proches</Text>
            </TouchableOpacity>
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
            <View testID="subscription-active" style={{ gap: spacing.md }}>
              <View style={styles.activeCard}>
                <Ionicons name="checkmark-circle" size={24} color={colors.success} />
                <Text style={styles.activeTxt}>Vous êtes Premium</Text>
              </View>
              <TouchableOpacity
                style={styles.cancelBtn}
                onPress={cancelSub}
                disabled={canceling}
                testID="cancel-sub-btn"
              >
                {canceling ? (
                  <ActivityIndicator color={colors.textSecondary} />
                ) : (
                  <Text style={styles.cancelTxt}>Résilier mon abonnement</Text>
                )}
              </TouchableOpacity>
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
                  <Text style={styles.ctaTxt}>
                    {selectedTier === "unlimited" ? "S'abonner — 2,30€/mois" : "S'abonner — 1,99€/mois"}
                  </Text>
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
  tiersWrap: { gap: 12, marginVertical: spacing.lg },
  tierCard: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.lg,
    padding: spacing.md,
    position: "relative",
  },
  tierCardActive: { borderColor: colors.gold, backgroundColor: "rgba(212,175,55,0.06)" },
  tierHeader: { flexDirection: "row", alignItems: "center", gap: 8 },
  tierName: { color: colors.ivory, fontSize: 16, fontWeight: "700" },
  tierPrice: { color: colors.gold, fontSize: 30, fontWeight: "800", marginTop: 10, letterSpacing: -1 },
  tierUnit: { color: colors.textSecondary, fontSize: 14, fontWeight: "400" },
  tierBullet: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  bestBadge: { position: "absolute", top: -8, right: 12, backgroundColor: colors.gold, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  bestBadgeTxt: { color: "#0A0A0A", fontSize: 9, fontWeight: "800", letterSpacing: 1 },
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
  cancelBtn: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
    borderRadius: radii.sm,
  },
  cancelTxt: { color: colors.textSecondary, fontSize: 13, textDecorationLine: "underline" },
  legal: { alignItems: "center", marginTop: spacing.lg, paddingHorizontal: spacing.md },
  legalTxt: { color: colors.textSecondary, fontSize: 11, textAlign: "center", lineHeight: 16 },
  legalLink: { color: colors.gold, fontSize: 12, marginTop: 6 },
});

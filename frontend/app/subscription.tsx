import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
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

type PlanCode = "annual_commit" | "annual_free" | "monthly_free";

type PlanInfo = {
  code: PlanCode;
  label: string;
  amount: number;            // cents
  interval: "month" | "year";
  engagement: boolean;
  tier: string;
};

type BillingConfig = {
  publishable_key?: string;
  configured: boolean;
  plans: PlanInfo[];
};

const PLAN_BULLETS: Record<PlanCode, string[]> = {
  annual_commit: [
    "Économisez avec un paiement annuel",
    "Engagement de 12 mois",
    "Accès Premium illimité",
    "Jusqu'à 3 appareils par code mariage",
    "Notifications push & support prioritaire",
  ],
  annual_free: [
    "Paiement annuel d'un coup",
    "Sans engagement — résiliable à tout moment",
    "Accès Premium illimité",
    "Jusqu'à 3 appareils par code mariage",
    "Notifications push & support prioritaire",
  ],
  monthly_free: [
    "Paiement mensuel — flexible",
    "Sans engagement — résiliable à tout moment",
    "Accès Premium illimité",
    "Jusqu'à 3 appareils par code mariage",
    "Notifications push & support prioritaire",
  ],
};

const formatPrice = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} €`;

export default function SubscriptionScreen() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const params = useLocalSearchParams<{ status?: string; session_id?: string; plan?: string }>();
  const [config, setConfig] = useState<BillingConfig | null>(null);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<PlanCode>(
    (params.plan as PlanCode) || "monthly_free"
  );
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<BillingConfig>("/billing/config");
        setConfig(r);
      } catch {}
    })();
  }, []);

  // Process return from Stripe checkout
  useEffect(() => {
    if (params.status === "success") {
      (async () => {
        setVerifying(true);
        try {
          await api(`/billing/status?session_id=${params.session_id || ""}`);
          await refresh();
          showAlert("✓ Bienvenue Premium", "Votre abonnement est activé !");
        } catch {}
        finally { setVerifying(false); }
      })();
    } else if (params.status === "cancel") {
      showAlert("Paiement annulé", "Vous n'avez pas été débité. Vous pouvez réessayer à tout moment.");
    }
  }, [params.status, params.session_id, refresh]);

  const plans: PlanInfo[] = useMemo(() => {
    if (config?.plans?.length) return config.plans;
    // Fallback defaults in case the backend hasn't been updated yet
    return [
      { code: "annual_commit", label: "Premium Annuel — Engagement 12 mois", amount: 2388, interval: "year", engagement: true, tier: "basic" },
      { code: "annual_free", label: "Premium Annuel — Sans engagement", amount: 2760, interval: "year", engagement: false, tier: "unlimited" },
      { code: "monthly_free", label: "Premium Mensuel — Sans engagement", amount: 230, interval: "month", engagement: false, tier: "unlimited" },
    ];
  }, [config]);

  const currentPlan = (user as any)?.subscription_plan as PlanCode | undefined;
  const isSubscribed = !!user?.is_subscribed;
  const claimedClientId = (user as any)?.claimed_client_id as string | undefined;
  const claimedClientName = (user as any)?.claimed_client_name as string | undefined;
  const hasClaim = !!claimedClientId;

  const subscribe = async () => {
    if (!user) { router.push("/auth/login"); return; }
    if (!hasClaim) {
      showAlert(
        "Revendiquez d'abord votre mariage",
        "Avant de souscrire un abonnement, vous devez indiquer de quel mariage vous êtes le marié ou la mariée. Allez dans 'Mon mariage' depuis votre profil.",
        () => router.push("/claim-wedding")
      );
      return;
    }
    if (!acceptedTerms) {
      showAlert("Acceptation requise", "Vous devez accepter les CGV, CGU et la Politique de confidentialité.");
      return;
    }
    setLoading(true);
    try {
      const r = await api<{ url: string }>("/billing/checkout", {
        method: "POST",
        body: { plan: selectedPlan },
      });
      if (Platform.OS === "web") {
        window.location.href = r.url;
      } else {
        await WebBrowser.openBrowserAsync(r.url);
        await refresh();
      }
    } catch (e: any) {
      showAlert("Erreur", e.message || "Impossible de démarrer le paiement");
    } finally {
      setLoading(false);
    }
  };

  const cancelAndDeactivate = () => {
    const engagementWarning = currentPlan === "annual_commit"
      ? "\n\n⚠️ Vous êtes sur un plan avec engagement 12 mois. La résiliation ne sera possible qu'à la fin de l'engagement."
      : "\n\nVotre compte sera désactivé. Vos données sont conservées : vous pouvez réactiver à tout moment en vous reconnectant.";
    confirmAction(
      "Résilier et désactiver mon compte",
      `Cette action annulera votre abonnement Stripe et désactivera votre compte.${engagementWarning}`,
      async () => {
        setCanceling(true);
        try {
          await api("/billing/cancel-and-deactivate", { method: "POST", body: {} });
          await refresh();
          showAlert("Compte désactivé", "Votre abonnement a été résilié et votre compte est désactivé. Vous pouvez le réactiver à tout moment.");
          router.replace("/account-deactivated");
        } catch (e: any) {
          showAlert("Impossible de résilier", e.message || "Erreur Stripe");
        } finally {
          setCanceling(false);
        }
      },
      { destructive: true, confirmText: "Résilier" }
    );
  };

  if (verifying) {
    return (
      <View style={styles.loadingScreen}>
        <ActivityIndicator color={colors.gold} size="large" />
        <Text style={styles.loadingText}>Activation de votre abonnement…</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Premium</Text>
        <View style={{ width: 26 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* HERO */}
        <LinearGradient colors={["rgba(212,175,55,0.15)", "rgba(212,175,55,0)"]} style={styles.hero}>
          <Ionicons name="diamond" size={36} color={colors.gold} />
          <Text style={styles.heroTitle}>Accès Premium</Text>
          <Text style={styles.heroSub}>Choisissez la formule qui vous convient. Annulable à tout moment*.</Text>
          <Text style={styles.heroSubSmall}>*Sauf engagement 12 mois (formule la plus économique)</Text>
        </LinearGradient>

        {/* CURRENT SUBSCRIPTION BOX */}
        {isSubscribed && currentPlan ? (
          <View style={styles.currentBox}>
            <View style={styles.currentTopRow}>
              <Ionicons name="checkmark-circle" size={18} color={colors.gold} />
              <Text style={styles.currentLabel}>Abonnement actif</Text>
            </View>
            <Text style={styles.currentPlanName}>{plans.find(p => p.code === currentPlan)?.label || currentPlan}</Text>
            <TouchableOpacity style={styles.cancelBtn} onPress={cancelAndDeactivate} disabled={canceling}>
              {canceling ? (
                <ActivityIndicator color="#EF5350" size="small" />
              ) : (
                <Text style={styles.cancelTxt}>Résilier & désactiver mon compte</Text>
              )}
            </TouchableOpacity>
          </View>
        ) : null}

        {/* PLANS */}
        <Text style={styles.sectionTitle}>{isSubscribed ? "Changer de formule" : "Choisissez votre formule"}</Text>

        {plans.map((p) => {
          const active = selectedPlan === p.code;
          const isCurrent = isSubscribed && currentPlan === p.code;
          const monthlyEq = p.interval === "year" ? (p.amount / 12 / 100).toFixed(2).replace(".", ",") : null;
          return (
            <TouchableOpacity
              key={p.code}
              style={[styles.planCard, active && styles.planCardActive, isCurrent && styles.planCardCurrent]}
              onPress={() => setSelectedPlan(p.code)}
              testID={`plan-${p.code}`}
              activeOpacity={0.85}
            >
              {p.engagement && (
                <View style={styles.badgeBest}>
                  <Text style={styles.badgeBestTxt}>★ MEILLEUR PRIX</Text>
                </View>
              )}
              {isCurrent && (
                <View style={styles.badgeCurrent}>
                  <Text style={styles.badgeCurrentTxt}>FORMULE ACTUELLE</Text>
                </View>
              )}
              <View style={styles.planHeader}>
                <Ionicons
                  name={p.engagement ? "trophy" : p.interval === "year" ? "calendar" : "flash"}
                  size={22}
                  color={active ? colors.gold : colors.textSecondary}
                />
                <Text style={[styles.planName, active && { color: colors.gold }]} numberOfLines={2}>{p.label}</Text>
                {active && <Ionicons name="checkmark-circle" size={22} color={colors.gold} style={{ marginLeft: "auto" }} />}
              </View>

              <View style={styles.priceRow}>
                <Text style={styles.priceMain}>{formatPrice(p.amount)}</Text>
                <Text style={styles.priceUnit}>/ {p.interval === "year" ? "an" : "mois"}</Text>
              </View>
              {monthlyEq && (
                <Text style={styles.priceEq}>≈ {monthlyEq} € / mois</Text>
              )}

              {PLAN_BULLETS[p.code].map((b, i) => (
                <View key={i} style={styles.bulletRow}>
                  <Ionicons name="checkmark" size={14} color={active ? colors.gold : colors.textSecondary} />
                  <Text style={[styles.bullet, active && { color: colors.ivory }]}>{b}</Text>
                </View>
              ))}
            </TouchableOpacity>
          );
        })}

        {!isSubscribed && (
          <>
            {/* TERMS */}
            <TouchableOpacity style={styles.termsRow} onPress={() => setAcceptedTerms(!acceptedTerms)} testID="accept-terms-btn">
              <Ionicons name={acceptedTerms ? "checkbox" : "square-outline"} size={22} color={acceptedTerms ? colors.gold : colors.textSecondary} />
              <Text style={styles.termsTxt}>
                J'accepte les{" "}
                <Text style={styles.termsLink} onPress={() => router.push("/legal/cgv")}>CGV</Text>,{" "}
                <Text style={styles.termsLink} onPress={() => router.push("/legal/cgu")}>CGU</Text>{" "}et la{" "}
                <Text style={styles.termsLink} onPress={() => router.push("/legal/privacy")}>Politique de confidentialité</Text>.
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.subscribeBtn, (loading || !acceptedTerms) && { opacity: 0.45 }]}
              onPress={subscribe}
              disabled={loading || !acceptedTerms}
              testID="subscribe-btn"
            >
              {loading ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <>
                  <Ionicons name="lock-closed" size={16} color="#0A0A0A" />
                  <Text style={styles.subscribeTxt}>S'abonner — {formatPrice(plans.find(p => p.code === selectedPlan)?.amount || 0)}</Text>
                </>
              )}
            </TouchableOpacity>

            <View style={styles.securityRow}>
              <Ionicons name="shield-checkmark" size={14} color={colors.textSecondary} />
              <Text style={styles.securityTxt}>Paiement sécurisé par Stripe · CB / Apple Pay / Google Pay</Text>
            </View>

            {/* RESTORE PURCHASE — heals missed webhooks */}
            <TouchableOpacity
              style={styles.restoreBtn}
              onPress={async () => {
                try {
                  setVerifying(true);
                  const r = await api<{ ok: boolean; is_subscribed: boolean }>("/billing/refresh", { method: "POST" });
                  await refresh();
                  if (r.is_subscribed) {
                    showAlert("✓ Abonnement restauré", "Votre accès Premium est de nouveau actif !");
                  } else {
                    showAlert("Aucun abonnement actif trouvé", "Si vous venez de payer, attendez 30 secondes et réessayez. Sinon contactez le support.");
                  }
                } catch (e: any) {
                  showAlert("Erreur", e?.message || "Impossible de rafraîchir");
                } finally {
                  setVerifying(false);
                }
              }}
              disabled={verifying}
              testID="restore-purchase-btn"
            >
              <Ionicons name="refresh" size={14} color={colors.gold} />
              <Text style={styles.restoreTxt}>
                {verifying ? "Vérification..." : "J'ai déjà payé — restaurer mon abonnement"}
              </Text>
            </TouchableOpacity>
          </>
        )}

        <Text style={styles.footer}>
          Vous pouvez résilier à tout moment depuis cette page (sauf engagement 12 mois). Votre compte sera désactivé mais vos données conservées : vous pouvez le réactiver à tout moment en payant à nouveau.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loadingScreen: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", gap: 16 },
  loadingText: { color: colors.ivory, fontSize: 14 },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 10 },
  headerTitle: { flex: 1, color: colors.ivory, fontSize: 18, fontWeight: "700", textAlign: "center" },
  scroll: { padding: spacing.md, paddingBottom: 60 },
  hero: { alignItems: "center", padding: 24, borderRadius: radii.md, marginBottom: 18 },
  heroTitle: { color: colors.ivory, fontSize: 22, fontWeight: "800", marginTop: 8 },
  heroSub: { color: colors.textSecondary, fontSize: 13, marginTop: 4, textAlign: "center" },
  heroSubSmall: { color: colors.textDisabled, fontSize: 11, marginTop: 2, fontStyle: "italic", textAlign: "center" },

  currentBox: {
    padding: 14,
    borderRadius: radii.md,
    backgroundColor: "rgba(212,175,55,0.08)",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.4)",
    marginBottom: 14,
  },
  currentTopRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  currentLabel: { color: colors.gold, fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  currentPlanName: { color: colors.ivory, fontSize: 15, fontWeight: "600", marginTop: 4 },
  cancelBtn: { marginTop: 12, alignSelf: "flex-start", paddingVertical: 8, paddingHorizontal: 0 },
  cancelTxt: { color: "#EF5350", fontSize: 12, fontWeight: "600", textDecorationLine: "underline" },

  sectionTitle: { color: colors.textSecondary, fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10, marginTop: 6 },

  planCard: {
    backgroundColor: colors.surface,
    padding: 16,
    borderRadius: radii.md,
    marginBottom: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    position: "relative",
  },
  planCardActive: { borderColor: colors.gold, backgroundColor: "rgba(212,175,55,0.05)" },
  planCardCurrent: { borderColor: "rgba(212,175,55,0.6)" },
  badgeBest: { position: "absolute", top: -8, right: 14, backgroundColor: colors.gold, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeBestTxt: { color: "#0A0A0A", fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  badgeCurrent: { position: "absolute", top: -8, left: 14, backgroundColor: "#4CAF50", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  badgeCurrentTxt: { color: "#FFFFFF", fontSize: 9, fontWeight: "800", letterSpacing: 0.5 },
  planHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 8 },
  planName: { flex: 1, color: colors.ivory, fontSize: 14, fontWeight: "700" },
  priceRow: { flexDirection: "row", alignItems: "flex-end", marginBottom: 2 },
  priceMain: { color: colors.gold, fontSize: 28, fontWeight: "800" },
  priceUnit: { color: colors.textSecondary, fontSize: 13, marginLeft: 4, marginBottom: 6 },
  priceEq: { color: colors.textDisabled, fontSize: 11, marginBottom: 8 },
  bulletRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  bullet: { color: colors.textSecondary, fontSize: 12, flex: 1 },

  termsRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginTop: 8, marginBottom: 14, padding: 4 },
  termsTxt: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  termsLink: { color: colors.gold, textDecorationLine: "underline" },

  subscribeBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.gold, paddingVertical: 16, borderRadius: radii.sm, marginTop: 4 },
  subscribeTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 14, letterSpacing: 0.4 },
  securityRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, marginTop: 10 },
  securityTxt: { color: colors.textSecondary, fontSize: 10 },
  restoreBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", paddingVertical: 12, marginTop: 14, gap: 6, borderTopWidth: 1, borderTopColor: "rgba(212,175,55,0.15)" },
  restoreTxt: { color: colors.gold, fontSize: 12, fontWeight: "600" },

  footer: { color: colors.textDisabled, fontSize: 11, lineHeight: 16, textAlign: "center", marginTop: 24, fontStyle: "italic" },
});

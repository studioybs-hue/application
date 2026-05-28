/**
 * Account Deactivated screen.
 * Shown when a logged-in user has `is_active === false` (after they cancelled and deactivated).
 * Offers a "Reactivate" CTA that triggers a new Stripe checkout.
 */
import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { showAlert } from "@/src/utils/dialog";
import { colors, spacing, radii } from "@/src/theme";

type Plan = "annual_commit" | "annual_free" | "monthly_free";

const PLAN_OPTIONS: { code: Plan; label: string; price: string; sub: string }[] = [
  { code: "annual_commit", label: "Annuel — Engagement 12 mois", price: "23,88 €", sub: "≈ 1,99 €/mois · le moins cher" },
  { code: "annual_free", label: "Annuel — Sans engagement", price: "27,60 €", sub: "≈ 2,30 €/mois · résiliable" },
  { code: "monthly_free", label: "Mensuel — Sans engagement", price: "2,30 €/mois", sub: "Flexible · résiliable à tout moment" },
];

export default function AccountDeactivated() {
  const router = useRouter();
  const { user, refresh, logout } = useAuth();
  const [reactivating, setReactivating] = useState(false);
  const [selected, setSelected] = useState<Plan>("monthly_free");

  // If user is active again (somehow), bounce back home
  if (user && (user as any).is_active !== false) {
    setTimeout(() => router.replace("/"), 50);
    return null;
  }

  const reactivate = async () => {
    setReactivating(true);
    try {
      const r = await api<{ url: string }>("/billing/reactivate", {
        method: "POST",
        body: { plan: selected },
      });
      if (Platform.OS === "web") {
        window.location.href = r.url;
      } else {
        await WebBrowser.openBrowserAsync(r.url);
        await refresh();
      }
    } catch (e: any) {
      showAlert("Erreur", e.message || "Impossible de relancer le paiement.");
    } finally {
      setReactivating(false);
    }
  };

  const handleLogout = async () => {
    await logout();
    router.replace("/");
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <LinearGradient colors={["rgba(239,83,80,0.18)", "rgba(239,83,80,0)"]} style={styles.hero}>
          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed" size={42} color="#EF5350" />
          </View>
          <Text style={styles.title}>Compte désactivé</Text>
          <Text style={styles.subtitle}>
            Votre compte CINÉMARIÉS est actuellement désactivé. Vos données sont
            conservées en sécurité. Réactivez votre abonnement pour retrouver
            votre accès Premium immédiatement.
          </Text>
        </LinearGradient>

        <Text style={styles.sectionTitle}>Choisissez votre nouvelle formule</Text>

        {PLAN_OPTIONS.map((opt) => {
          const active = selected === opt.code;
          return (
            <TouchableOpacity
              key={opt.code}
              style={[styles.optCard, active && styles.optCardActive]}
              onPress={() => setSelected(opt.code)}
              testID={`reactivate-${opt.code}`}
              activeOpacity={0.85}
            >
              <Ionicons
                name={active ? "radio-button-on" : "radio-button-off"}
                size={22}
                color={active ? colors.gold : colors.textSecondary}
              />
              <View style={{ flex: 1 }}>
                <Text style={[styles.optLabel, active && { color: colors.gold }]}>{opt.label}</Text>
                <Text style={styles.optSub}>{opt.sub}</Text>
              </View>
              <Text style={[styles.optPrice, active && { color: colors.gold }]}>{opt.price}</Text>
            </TouchableOpacity>
          );
        })}

        <TouchableOpacity
          style={[styles.reactivateBtn, reactivating && { opacity: 0.6 }]}
          onPress={reactivate}
          disabled={reactivating}
          testID="reactivate-btn"
        >
          {reactivating ? (
            <ActivityIndicator color="#0A0A0A" />
          ) : (
            <>
              <Ionicons name="refresh-circle" size={20} color="#0A0A0A" />
              <Text style={styles.reactivateTxt}>Réactiver mon compte</Text>
            </>
          )}
        </TouchableOpacity>

        <View style={styles.dataRow}>
          <Ionicons name="shield-checkmark" size={14} color={colors.textSecondary} />
          <Text style={styles.dataTxt}>
            Vos mariages, codes et historiques sont conservés. La réactivation est immédiate après le paiement.
          </Text>
        </View>

        <TouchableOpacity onPress={handleLogout} style={styles.logoutBtn} testID="deactivated-logout-btn">
          <Text style={styles.logoutTxt}>Se déconnecter</Text>
        </TouchableOpacity>

        <Text style={styles.help}>
          Une question ? Contactez-nous à{" "}
          <Text style={styles.helpLink}>contact@creativindustry.com</Text>
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, paddingBottom: 60 },
  hero: { alignItems: "center", padding: 28, borderRadius: radii.md, marginBottom: 24 },
  iconWrap: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: "rgba(239,83,80,0.12)",
    alignItems: "center", justifyContent: "center",
    marginBottom: 14,
  },
  title: { color: colors.ivory, fontSize: 24, fontWeight: "800", textAlign: "center" },
  subtitle: { color: colors.textSecondary, fontSize: 13, marginTop: 10, textAlign: "center", lineHeight: 20 },

  sectionTitle: { color: colors.textSecondary, fontSize: 12, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 10 },

  optCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    backgroundColor: colors.surface,
    padding: 14, borderRadius: radii.md,
    borderWidth: 1.5, borderColor: colors.border,
    marginBottom: 8,
  },
  optCardActive: { borderColor: colors.gold, backgroundColor: "rgba(212,175,55,0.05)" },
  optLabel: { color: colors.ivory, fontSize: 14, fontWeight: "700" },
  optSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  optPrice: { color: colors.ivory, fontSize: 14, fontWeight: "800" },

  reactivateBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.gold,
    paddingVertical: 16,
    borderRadius: radii.sm,
    marginTop: 18,
  },
  reactivateTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 15, letterSpacing: 0.4 },

  dataRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12, paddingHorizontal: 6 },
  dataTxt: { flex: 1, color: colors.textSecondary, fontSize: 11, lineHeight: 16 },

  logoutBtn: { alignSelf: "center", marginTop: 28, padding: 8 },
  logoutTxt: { color: colors.textSecondary, fontSize: 13, textDecorationLine: "underline" },

  help: { color: colors.textDisabled, fontSize: 11, textAlign: "center", marginTop: 24 },
  helpLink: { color: colors.gold },
});

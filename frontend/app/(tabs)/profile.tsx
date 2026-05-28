import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing, radii } from "@/src/theme";
import { useAuth } from "@/src/auth/AuthContext";
import { useConfirm } from "@/src/ui/ConfirmDialog";
import { api } from "@/src/api/client";
import { showAlert } from "@/src/utils/dialog";

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();
  const confirm = useConfirm();

  const exportData = async () => {
    try {
      const data = await api<any>("/me/export");
      const json = JSON.stringify(data, null, 2);
      if (Platform.OS === "web") {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `cinemaries-mes-donnees-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showAlert("Export RGPD", "Vos données ont été téléchargées au format JSON.");
      } else {
        // Native: try to share / save via FileSystem
        try {
          const FS = await import("expo-file-system");
          const Sharing = await import("expo-sharing");
          const fileUri = `${FS.documentDirectory}cinemaries-mes-donnees-${Date.now()}.json`;
          await FS.writeAsStringAsync(fileUri, json, { encoding: FS.EncodingType.UTF8 });
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(fileUri, { mimeType: "application/json" });
          } else {
            showAlert("Export RGPD", `Fichier enregistré : ${fileUri}`);
          }
        } catch {
          showAlert("Export RGPD", "Données exportées. Aperçu :\n\n" + json.slice(0, 400) + "...");
        }
      }
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Impossible d'exporter vos données.");
    }
  };

  const deleteAccount = async () => {
    const ok = await confirm({
      title: "Demander la suppression",
      message:
        "Cette action enverra une demande à notre équipe qui la traitera sous 30 jours (RGPD Art. 17). Vous serez notifié par email à chaque étape. Pensez à résilier votre abonnement Stripe avant. Continuer ?",
      confirmText: "Envoyer la demande",
      destructive: true,
      icon: "trash-outline",
    });
    if (!ok) return;
    const ok2 = await confirm({
      title: "Confirmation finale",
      message: "Êtes-vous sûr de vouloir envoyer cette demande de suppression définitive de compte ?",
      confirmText: "Oui, envoyer",
      destructive: true,
      icon: "warning-outline",
    });
    if (!ok2) return;
    try {
      const r = await api<any>("/me", { method: "DELETE" });
      showAlert(
        "Demande envoyée",
        r?.message || "Votre demande a été enregistrée. Vous recevrez un email de confirmation sous 30 jours."
      );
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Impossible d'envoyer la demande.");
    }
  };

  const openStripePortal = async () => {
    try {
      const r = await api<{ url: string }>("/billing/portal", { method: "POST" });
      if (Platform.OS === "web") {
        window.location.href = r.url;
      } else {
        const WebBrowser = await import("expo-web-browser");
        await WebBrowser.openBrowserAsync(r.url);
      }
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Impossible d'ouvrir le portail Stripe.");
    }
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.guest} testID="profile-guest">
        <Ionicons name="person-circle-outline" size={80} color={colors.gold} />
        <Text style={styles.guestTitle}>Bienvenue</Text>
        <Text style={styles.guestSub}>
          Créez un compte pour débloquer vos vidéos et profiter du streaming premium.
        </Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.push("/auth/login")}
          testID="profile-login-btn"
        >
          <Text style={styles.primaryTxt}>Se connecter</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => router.push("/auth/register")} testID="profile-register-link">
          <Text style={styles.linkTxt}>Créer un compte</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  const onLogout = async () => {
    const ok = await confirm({
      title: "Déconnexion",
      message: "Voulez-vous vraiment vous déconnecter ?",
      confirmText: "Déconnexion",
      destructive: true,
      icon: "log-out-outline",
    });
    if (!ok) return;
    await logout();
    router.replace("/(tabs)/home");
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: spacing.md }}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>
              {(user.full_name || user.email).slice(0, 1).toUpperCase()}
            </Text>
          </View>
          <Text style={styles.name}>{user.full_name}</Text>
          <Text style={styles.email}>{user.email}</Text>
          <View style={[styles.statusBadge, user.is_subscribed ? styles.statusActive : styles.statusInactive]}>
            <Ionicons
              name={user.is_subscribed ? "star" : "star-outline"}
              size={12}
              color={user.is_subscribed ? "#0A0A0A" : colors.gold}
            />
            <Text style={user.is_subscribed ? styles.statusActiveTxt : styles.statusInactiveTxt}>
              {user.is_subscribed ? "Premium actif" : "Sans abonnement"}
            </Text>
          </View>
        </View>

        <Section title="Mon compte">
          <Item
            icon="key-outline"
            label="Saisir un code de déblocage"
            onPress={() => router.push("/unlock")}
            testID="profile-unlock-btn"
          />
          <Item
            icon="card-outline"
            label={user.is_subscribed ? "Gérer mon abonnement" : "S'abonner — 1,99€/mois"}
            onPress={() => router.push("/subscription")}
            testID="profile-subscription-btn"
            accent={!user.is_subscribed}
          />
          {user.is_subscribed && (
            <Item
              icon="receipt-outline"
              label="Portail Stripe (factures, moyens de paiement)"
              onPress={openStripePortal}
              testID="profile-stripe-portal-btn"
            />
          )}
          <Item
            icon="bookmark-outline"
            label="Ma bibliothèque"
            onPress={() => router.push("/(tabs)/library")}
            testID="profile-library-btn"
          />
        </Section>

        {user.is_admin && (
          <Section title="Administration">
            <Item
              icon="shield-checkmark-outline"
              label="Espace Admin"
              onPress={() => router.push("/admin")}
              testID="profile-admin-btn"
              accent
            />
          </Section>
        )}

        <Section title="Application">
          <Item icon="document-text-outline" label="Demander un devis" onPress={() => router.push("/devis")} testID="profile-devis-btn" />
          <Item icon="chatbubbles-outline" label="Aide & Support" onPress={() => router.push("/support")} testID="profile-support-btn" />
          <Item icon="information-circle-outline" label="À propos / Contact" onPress={() => router.push("/about")} testID="profile-about-btn" />
          <Item icon="document-text-outline" label="Documents légaux" onPress={() => router.push("/legal")} testID="profile-legal-btn" />
          <Item icon="tv-outline" label="Version TV (bientôt)" disabled testID="profile-tv-btn" />
        </Section>

        <Section title="Vie privée & RGPD">
          <Item
            icon="download-outline"
            label="Exporter mes données (JSON)"
            onPress={exportData}
            testID="profile-export-btn"
          />
          <Item
            icon="trash-outline"
            label="Supprimer mon compte"
            onPress={deleteAccount}
            testID="profile-delete-btn"
            destructive
          />
        </Section>

        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout} testID="profile-logout-btn">
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.logoutTxt}>Déconnexion</Text>
        </TouchableOpacity>

        <View style={styles.legalFooter}>
          <TouchableOpacity onPress={() => router.push("/legal/mentions")}>
            <Text style={styles.legalFooterLink}>Mentions légales</Text>
          </TouchableOpacity>
          <Text style={styles.legalFooterDot}>·</Text>
          <TouchableOpacity onPress={() => router.push("/legal/privacy")}>
            <Text style={styles.legalFooterLink}>Confidentialité</Text>
          </TouchableOpacity>
          <Text style={styles.legalFooterDot}>·</Text>
          <TouchableOpacity onPress={() => router.push("/legal/cgu")}>
            <Text style={styles.legalFooterLink}>CGU</Text>
          </TouchableOpacity>
          <Text style={styles.legalFooterDot}>·</Text>
          <TouchableOpacity onPress={() => router.push("/legal/cgv")}>
            <Text style={styles.legalFooterLink}>CGV</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.footerTxt}>CINÉMARIÉS · v1.0</Text>
        <Text style={styles.footerSub}>by Creativindustry France</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginTop: spacing.lg }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.section}>{children}</View>
    </View>
  );
}

function Item({
  icon,
  label,
  onPress,
  testID,
  disabled,
  accent,
  destructive,
}: {
  icon: any;
  label: string;
  onPress?: () => void;
  testID: string;
  disabled?: boolean;
  accent?: boolean;
  destructive?: boolean;
}) {
  const tint = destructive ? colors.error : accent ? colors.gold : colors.ivory;
  return (
    <TouchableOpacity
      style={[styles.item, disabled && { opacity: 0.4 }]}
      onPress={disabled ? undefined : onPress}
      activeOpacity={0.7}
      testID={testID}
    >
      <Ionicons name={icon} size={20} color={tint} />
      <Text style={[styles.itemLabel, { color: tint, fontWeight: destructive || accent ? "700" : "400" }]}>
        {label}
      </Text>
      {!disabled && <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  guest: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  guestTitle: { color: colors.ivory, fontSize: 24, fontWeight: "700", marginTop: spacing.md },
  guestSub: { color: colors.textSecondary, textAlign: "center", marginTop: 8, marginBottom: spacing.lg },
  primaryBtn: { backgroundColor: colors.gold, paddingHorizontal: 36, paddingVertical: 14, borderRadius: radii.sm },
  primaryTxt: { color: "#0A0A0A", fontWeight: "700" },
  linkTxt: { color: colors.gold, marginTop: spacing.md, fontWeight: "600" },
  avatarWrap: { alignItems: "center", marginTop: spacing.md },
  avatar: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: colors.wine,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.gold,
  },
  avatarTxt: { color: colors.gold, fontSize: 38, fontWeight: "700" },
  name: { color: colors.ivory, fontSize: 20, fontWeight: "700", marginTop: spacing.md },
  email: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  statusBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    marginTop: spacing.sm,
  },
  statusActive: { backgroundColor: colors.gold },
  statusActiveTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 12 },
  statusInactive: { borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  statusInactiveTxt: { color: colors.gold, fontWeight: "600", fontSize: 12 },
  sectionTitle: {
    color: colors.textSecondary,
    fontSize: 12,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: spacing.sm,
    paddingHorizontal: 4,
  },
  section: { backgroundColor: colors.surface, borderRadius: radii.md, overflow: "hidden", borderWidth: 1, borderColor: "rgba(255,255,255,0.05)" },
  item: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    gap: spacing.md,
    borderBottomWidth: 0.5,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  itemLabel: { color: colors.ivory, flex: 1, fontSize: 15 },
  logoutBtn: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 14,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: "rgba(211,47,47,0.4)",
  },
  logoutTxt: { color: colors.error, fontWeight: "600" },
  legalFooter: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 4, marginTop: spacing.lg },
  legalFooterLink: { color: colors.textSecondary, fontSize: 11, paddingHorizontal: 4, paddingVertical: 4 },
  legalFooterDot: { color: colors.textDisabled, fontSize: 10 },
  footerTxt: { color: colors.textDisabled, fontSize: 11, textAlign: "center", marginTop: spacing.md, letterSpacing: 1 },
  footerSub: { color: colors.textDisabled, fontSize: 10, textAlign: "center", marginTop: 4, marginBottom: spacing.md, fontStyle: "italic", opacity: 0.7 },
});

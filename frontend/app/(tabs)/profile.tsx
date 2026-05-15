import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { colors, spacing, radii } from "@/src/theme";
import { useAuth } from "@/src/auth/AuthContext";

export default function ProfileScreen() {
  const router = useRouter();
  const { user, logout } = useAuth();

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

  const onLogout = () => {
    const doLogout = async () => {
      await logout();
      router.replace("/(tabs)/home");
    };
    if (Platform.OS === "web") {
      // eslint-disable-next-line no-alert
      const ok = typeof window !== "undefined" && window.confirm("Voulez-vous vraiment vous déconnecter ?");
      if (ok) doLogout();
      return;
    }
    Alert.alert("Déconnexion", "Voulez-vous vraiment vous déconnecter ?", [
      { text: "Annuler", style: "cancel" },
      { text: "Déconnexion", style: "destructive", onPress: doLogout },
    ]);
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
          <Item icon="tv-outline" label="Version TV (bientôt)" disabled testID="profile-tv-btn" />
          <Item icon="information-circle-outline" label="À propos" disabled testID="profile-about-btn" />
        </Section>

        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout} testID="profile-logout-btn">
          <Ionicons name="log-out-outline" size={18} color={colors.error} />
          <Text style={styles.logoutTxt}>Déconnexion</Text>
        </TouchableOpacity>

        <Text style={styles.footerTxt}>CINÉMARIÉS · v1.0</Text>
        <Text style={styles.footerSub}>by Creative Industry France</Text>
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
}: {
  icon: any;
  label: string;
  onPress?: () => void;
  testID: string;
  disabled?: boolean;
  accent?: boolean;
}) {
  return (
    <TouchableOpacity
      style={[styles.item, disabled && { opacity: 0.4 }]}
      onPress={disabled ? undefined : onPress}
      activeOpacity={0.7}
      testID={testID}
    >
      <Ionicons name={icon} size={20} color={accent ? colors.gold : colors.ivory} />
      <Text style={[styles.itemLabel, accent && { color: colors.gold, fontWeight: "700" }]}>{label}</Text>
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
  footerTxt: { color: colors.textDisabled, fontSize: 11, textAlign: "center", marginTop: spacing.lg, letterSpacing: 1 },
  footerSub: { color: colors.textDisabled, fontSize: 10, textAlign: "center", marginTop: 4, marginBottom: spacing.md, fontStyle: "italic", opacity: 0.7 },
});

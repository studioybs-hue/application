/**
 * Security settings — manage 2FA (Two-Factor Authentication) for admin accounts.
 * - Enable 2FA (Email OTP) with password confirmation → returns 8 recovery codes ONCE
 * - Disable 2FA (requires password)
 * - Regenerate recovery codes
 */
import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from "react-native";
import * as Clipboard from "expo-clipboard";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { auth as authApi } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { showAlert } from "@/src/utils/dialog";
import { colors, spacing, radii } from "@/src/theme";

export default function SecurityScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [status, setStatus] = useState<{
    enabled: boolean;
    method: string | null;
    recovery_codes_remaining: number;
    available_for_role: boolean;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [pendingAction, setPendingAction] = useState<
    "enable" | "disable" | "regenerate" | null
  >(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const s = await authApi.get2FAStatus();
      setStatus(s);
    } catch (e: any) {
      setError(e?.message || "Erreur de chargement");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const submitPassword = async () => {
    if (!password) {
      setError("Saisissez votre mot de passe pour confirmer.");
      return;
    }
    setError("");
    setBusy(true);
    try {
      if (pendingAction === "enable") {
        const r = await authApi.enable2FA(password);
        setNewCodes(r.recovery_codes);
        await load();
      } else if (pendingAction === "disable") {
        await authApi.disable2FA(password);
        await load();
        showAlert("2FA désactivée", "La double authentification a été désactivée.");
      } else if (pendingAction === "regenerate") {
        const r = await authApi.regenerateRecoveryCodes(password);
        setNewCodes(r.recovery_codes);
        await load();
      }
      setPassword("");
      setPendingAction(null);
    } catch (e: any) {
      setError(e?.message || "Erreur");
    } finally {
      setBusy(false);
    }
  };

  const copyAllCodes = async () => {
    if (!newCodes) return;
    const text = `CINÉMARIÉS — Codes de récupération 2FA\n\n${newCodes.join("\n")}\n\nGarde-les en lieu sûr (gestionnaire de mots de passe, coffre, papier).`;
    try {
      await Clipboard.setStringAsync(text);
      showAlert("Copié", "Les 8 codes ont été copiés dans le presse-papiers.");
    } catch {}
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <ActivityIndicator color={colors.gold} />
        </View>
      </SafeAreaView>
    );
  }

  if (!user) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.muted}>Connectez-vous pour accéder à cette page.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Codes display modal (shown after enable / regenerate)
  if (newCodes) {
    return (
      <SafeAreaView style={styles.root}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <TouchableOpacity
            onPress={() => setNewCodes(null)}
            style={styles.back}
          >
            <Ionicons name="close" size={26} color={colors.ivory} />
          </TouchableOpacity>

          <View style={styles.iconWrap}>
            <Ionicons name="key" size={56} color={colors.gold} />
          </View>
          <Text style={styles.title}>Vos codes de récupération</Text>
          <Text style={styles.sub}>
            ⚠️ SAUVEGARDEZ ces 8 codes — ils ne seront PLUS JAMAIS affichés.{"\n\n"}
            Chacun est à usage unique. Utilisez-les si vous perdez l&apos;accès à votre email.
          </Text>

          <View style={styles.codesGrid}>
            {newCodes.map((c) => (
              <View key={c} style={styles.codeBox}>
                <Text style={styles.codeTxt}>{c}</Text>
              </View>
            ))}
          </View>

          <TouchableOpacity style={styles.primaryBtn} onPress={copyAllCodes}>
            <Ionicons name="copy-outline" size={18} color="#0A0A0A" />
            <Text style={styles.primaryTxt}> Copier les 8 codes</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => setNewCodes(null)}
          >
            <Text style={styles.secondaryTxt}>J&apos;ai bien sauvegardé mes codes</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Password confirmation modal
  if (pendingAction) {
    const labels = {
      enable: { title: "Activer la 2FA", action: "Activer" },
      disable: { title: "Désactiver la 2FA", action: "Désactiver" },
      regenerate: { title: "Régénérer les codes", action: "Régénérer" },
    };
    const cur = labels[pendingAction];
    return (
      <SafeAreaView style={styles.root}>
        <ScrollView contentContainerStyle={styles.scroll}>
          <TouchableOpacity
            onPress={() => {
              setPendingAction(null);
              setPassword("");
              setError("");
            }}
            style={styles.back}
          >
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>

          <Text style={styles.title}>{cur.title}</Text>
          <Text style={styles.sub}>
            Confirmez votre mot de passe pour continuer.
          </Text>

          <View style={styles.field}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.input}
              placeholder="Mot de passe actuel"
              placeholderTextColor={colors.textDisabled}
              secureTextEntry={!showPassword}
              value={password}
              onChangeText={setPassword}
              autoFocus
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)}>
              <Ionicons
                name={showPassword ? "eye-off-outline" : "eye-outline"}
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={submitPassword}
            disabled={busy}
          >
            {busy ? (
              <ActivityIndicator color="#0A0A0A" />
            ) : (
              <Text style={styles.primaryTxt}>{cur.action}</Text>
            )}
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  // Default status view
  return (
    <SafeAreaView style={styles.root}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={styles.back}>
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>

        <View style={styles.iconWrap}>
          <Ionicons name="shield-checkmark" size={56} color={colors.gold} />
        </View>
        <Text style={styles.title}>Sécurité du compte</Text>
        <Text style={styles.sub}>
          Renforcez la sécurité de votre compte avec la double authentification (2FA) par email.
        </Text>

        {!status?.available_for_role && (
          <View style={styles.infoBox}>
            <Ionicons name="information-circle" size={18} color={colors.textSecondary} />
            <Text style={styles.infoTxt}>
              {"  "}La 2FA est actuellement réservée aux comptes administrateurs.
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <View style={styles.cardRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardLabel}>Statut</Text>
              <Text
                style={[
                  styles.cardValue,
                  status?.enabled ? styles.green : styles.amber,
                ]}
              >
                {status?.enabled ? "✓ Activée (Email OTP)" : "✗ Désactivée"}
              </Text>
            </View>
          </View>
          {status?.enabled && (
            <View style={styles.cardRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.cardLabel}>Codes de récupération restants</Text>
                <Text
                  style={[
                    styles.cardValue,
                    (status?.recovery_codes_remaining ?? 0) <= 2
                      ? styles.amber
                      : styles.green,
                  ]}
                >
                  {status?.recovery_codes_remaining ?? 0} / 8
                </Text>
              </View>
            </View>
          )}
        </View>

        {!status?.enabled && status?.available_for_role && (
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => setPendingAction("enable")}
            testID="enable-2fa"
          >
            <Ionicons name="shield-checkmark-outline" size={18} color="#0A0A0A" />
            <Text style={styles.primaryTxt}> Activer la double authentification</Text>
          </TouchableOpacity>
        )}

        {status?.enabled && (
          <>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => setPendingAction("regenerate")}
              testID="regenerate-codes"
            >
              <Ionicons name="refresh-outline" size={18} color={colors.gold} />
              <Text style={styles.secondaryTxt}> Régénérer les codes de récupération</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.secondaryBtn, styles.dangerBtn]}
              onPress={() => setPendingAction("disable")}
              testID="disable-2fa"
            >
              <Ionicons name="close-circle-outline" size={18} color="#ff6464" />
              <Text style={[styles.secondaryTxt, { color: "#ff6464" }]}>
                {" "}Désactiver la 2FA
              </Text>
            </TouchableOpacity>
          </>
        )}

        <View style={styles.helpBox}>
          <Text style={styles.helpTitle}>Comment ça marche ?</Text>
          <Text style={styles.helpTxt}>
            • À chaque connexion, vous recevrez un code à 6 chiffres par email.{"\n"}
            • Saisissez-le pour accéder à votre compte.{"\n"}
            • Si vous perdez l&apos;accès à votre email, utilisez un de vos codes de récupération à
            usage unique.{"\n"}
            • Conservez les codes dans un endroit sûr (gestionnaire de mots de passe, papier, etc.).
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  back: { width: 40, height: 40, alignItems: "flex-start", justifyContent: "center" },
  iconWrap: { alignItems: "center", marginTop: spacing.md, marginBottom: spacing.md },
  title: { color: colors.ivory, fontSize: 24, fontWeight: "700", textAlign: "center" },
  sub: {
    color: colors.textSecondary,
    fontSize: 13,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.md,
    lineHeight: 20,
  },
  muted: { color: colors.textSecondary, fontSize: 14 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.sm,
    padding: spacing.md,
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  cardRow: { flexDirection: "row", alignItems: "center" },
  cardLabel: { color: colors.textSecondary, fontSize: 12, marginBottom: 4 },
  cardValue: { color: colors.ivory, fontSize: 15, fontWeight: "600" },
  green: { color: "#4caf50" },
  amber: { color: "#ffb74d" },
  infoBox: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    padding: spacing.sm,
    borderRadius: 4,
    marginVertical: spacing.sm,
  },
  infoTxt: { color: colors.textSecondary, fontSize: 12, flex: 1 },
  field: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    height: 54,
    marginBottom: spacing.sm,
    marginTop: spacing.md,
    gap: 10,
  },
  input: { flex: 1, color: colors.ivory, fontSize: 15 },
  error: { color: colors.error, marginTop: 4, marginBottom: 4, fontSize: 13, textAlign: "center" },
  primaryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.gold,
    paddingVertical: 16,
    borderRadius: radii.sm,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  primaryTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15, letterSpacing: 0.5 },
  secondaryBtn: {
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    borderRadius: radii.sm,
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "center",
  },
  secondaryTxt: { color: colors.gold, fontWeight: "600", fontSize: 14 },
  dangerBtn: { borderColor: "rgba(255,100,100,0.3)" },
  codesGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginVertical: spacing.md,
    justifyContent: "center",
  },
  codeBox: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radii.sm,
    paddingVertical: 12,
    paddingHorizontal: 16,
    minWidth: 130,
    alignItems: "center",
  },
  codeTxt: {
    color: colors.gold,
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 2,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  helpBox: {
    marginTop: spacing.xl,
    backgroundColor: "rgba(212,175,55,0.06)",
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    padding: spacing.md,
    borderRadius: 4,
  },
  helpTitle: { color: colors.gold, fontSize: 13, fontWeight: "700", marginBottom: 6 },
  helpTxt: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
});

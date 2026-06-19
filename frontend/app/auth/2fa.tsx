/**
 * 2FA verification screen — step 2 of admin login.
 * User receives a 6-digit code by email, enters it here.
 * Fallback: "Use a recovery code" link.
 */
import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { auth as authApi } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { showAlert } from "@/src/utils/dialog";
import { colors, spacing, radii } from "@/src/theme";

export default function TwoFAScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{
    pending_token?: string;
    masked_email?: string;
    expires_in_minutes?: string;
  }>();
  const { completeLoginWithUser } = useAuth();

  const [code, setCode] = useState("");
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [resending, setResending] = useState(false);
  const [maskedEmail, setMaskedEmail] = useState(params.masked_email || "");
  const pendingToken = params.pending_token || "";

  // Countdown timer
  const [remaining, setRemaining] = useState<number>(
    parseInt(params.expires_in_minutes || "10", 10) * 60,
  );
  const tick = useRef<any>(null);
  useEffect(() => {
    tick.current = setInterval(() => setRemaining((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(tick.current);
  }, []);
  const mm = String(Math.floor(remaining / 60)).padStart(2, "0");
  const ss = String(remaining % 60).padStart(2, "0");

  // If no pending_token, redirect back to login
  useEffect(() => {
    if (!pendingToken) {
      router.replace("/auth/login");
    }
  }, [pendingToken, router]);

  const verify = async () => {
    setError("");
    if (code.length !== 6) {
      setError("Saisissez le code à 6 chiffres reçu par email.");
      return;
    }
    setLoading(true);
    try {
      const r = await authApi.verify2FAOtp(pendingToken, code);
      completeLoginWithUser(r.user);
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setError(e?.message || "Code incorrect.");
    } finally {
      setLoading(false);
    }
  };

  const verifyRecovery = async () => {
    setError("");
    if (!recoveryCode.trim()) {
      setError("Saisissez un code de récupération.");
      return;
    }
    setLoading(true);
    try {
      const r = await authApi.use2FARecoveryCode(pendingToken, recoveryCode.trim());
      completeLoginWithUser(r.user);
      showAlert(
        "Code utilisé",
        `Il vous reste ${r.recovery_codes_remaining} code(s) de récupération. Pensez à en régénérer dans Sécurité.`,
      );
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setError(e?.message || "Code de récupération invalide.");
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setError("");
    setResending(true);
    try {
      const r = await authApi.resend2FAOtp(pendingToken);
      setMaskedEmail(r.masked_email);
      setRemaining((r.expires_in_minutes ?? 10) * 60);
      showAlert("📧 Code renvoyé", `Un nouveau code a été envoyé à ${r.masked_email}.`);
    } catch (e: any) {
      setError(e?.message || "Impossible de renvoyer le code.");
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.replace("/auth/login")} style={styles.back}>
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>

          <View style={styles.iconWrap}>
            <Ionicons name="shield-checkmark" size={56} color={colors.gold} />
          </View>

          <Text style={styles.title}>Double authentification</Text>
          <Text style={styles.sub}>
            {recoveryMode
              ? "Saisissez un de vos codes de récupération à usage unique"
              : `Nous avons envoyé un code à 6 chiffres à ${maskedEmail || "votre adresse email"}.`}
          </Text>

          {!recoveryMode ? (
            <>
              <View style={styles.field}>
                <Ionicons name="keypad-outline" size={18} color={colors.textSecondary} />
                <TextInput
                  style={[styles.input, styles.otpInput]}
                  placeholder="123456"
                  placeholderTextColor={colors.textDisabled}
                  keyboardType="number-pad"
                  maxLength={6}
                  value={code}
                  onChangeText={(v) => setCode(v.replace(/[^0-9]/g, ""))}
                  testID="otp-input"
                  autoFocus
                />
              </View>

              <Text style={styles.timer}>
                {remaining > 0 ? `Expire dans ${mm}:${ss}` : "Code expiré"}
              </Text>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={verify}
                disabled={loading || code.length !== 6}
                testID="otp-submit"
              >
                {loading ? (
                  <ActivityIndicator color="#0A0A0A" />
                ) : (
                  <Text style={styles.primaryTxt}>Vérifier</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.linkBtn}
                onPress={resend}
                disabled={resending}
              >
                <Text style={styles.linkTxt}>
                  {resending ? "Envoi…" : "📧 Renvoyer un code"}
                </Text>
              </TouchableOpacity>

              <View style={styles.divider}>
                <View style={styles.line} />
                <Text style={styles.dividerTxt}>ou</Text>
                <View style={styles.line} />
              </View>

              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => {
                  setRecoveryMode(true);
                  setError("");
                }}
              >
                <Ionicons name="key-outline" size={16} color={colors.gold} />
                <Text style={styles.secondaryTxt}> Utiliser un code de récupération</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <View style={styles.field}>
                <Ionicons name="key-outline" size={18} color={colors.textSecondary} />
                <TextInput
                  style={styles.input}
                  placeholder="XXXX-XXXX"
                  placeholderTextColor={colors.textDisabled}
                  autoCapitalize="characters"
                  value={recoveryCode}
                  onChangeText={setRecoveryCode}
                  testID="recovery-input"
                  autoFocus
                />
              </View>

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={verifyRecovery}
                disabled={loading || !recoveryCode.trim()}
                testID="recovery-submit"
              >
                {loading ? (
                  <ActivityIndicator color="#0A0A0A" />
                ) : (
                  <Text style={styles.primaryTxt}>Utiliser ce code</Text>
                )}
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.linkBtn}
                onPress={() => {
                  setRecoveryMode(false);
                  setError("");
                }}
              >
                <Text style={styles.linkTxt}>↩ Revenir au code email</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, paddingTop: spacing.lg, paddingBottom: spacing.xl },
  back: { width: 40, height: 40, alignItems: "flex-start", justifyContent: "center" },
  iconWrap: { alignItems: "center", marginTop: spacing.lg, marginBottom: spacing.md },
  title: { color: colors.ivory, fontSize: 26, fontWeight: "700", textAlign: "center" },
  sub: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.md,
    lineHeight: 20,
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    height: 60,
    marginBottom: spacing.sm,
    gap: 10,
  },
  input: { flex: 1, color: colors.ivory, fontSize: 16 },
  otpInput: {
    fontSize: 28,
    letterSpacing: 12,
    textAlign: "center",
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
  },
  timer: { color: colors.textSecondary, fontSize: 12, textAlign: "center", marginTop: 4, marginBottom: spacing.md },
  error: { color: colors.error, marginTop: 4, marginBottom: 4, fontSize: 13, textAlign: "center" },
  primaryBtn: {
    marginTop: spacing.sm,
    backgroundColor: colors.gold,
    paddingVertical: 16,
    borderRadius: radii.sm,
    alignItems: "center",
  },
  primaryTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15, letterSpacing: 0.5 },
  linkBtn: { paddingVertical: 14, alignItems: "center", marginTop: 4 },
  linkTxt: { color: colors.gold, fontSize: 13, fontWeight: "600" },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: spacing.md, gap: 12 },
  line: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.1)" },
  dividerTxt: { color: colors.textSecondary, fontSize: 12 },
  secondaryBtn: {
    flexDirection: "row",
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    borderRadius: radii.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryTxt: { color: colors.gold, fontWeight: "600", fontSize: 14 },
});

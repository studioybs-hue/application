/**
 * Forgot Password screen — 2 steps:
 *   1) User enters email → server sends 6-digit code by email
 *   2) User enters code + new password → password is reset
 */
import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { showAlert } from "@/src/utils/dialog";
import { colors, spacing, radii } from "@/src/theme";

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const requestCode = async () => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes("@")) {
      showAlert("Email invalide", "Veuillez entrer une adresse email valide.");
      return;
    }
    setLoading(true);
    try {
      await api("/auth/forgot-password", { method: "POST", body: { email: cleanEmail } });
      setStep(2);
      showAlert(
        "📧 Code envoyé",
        `Si un compte existe pour ${cleanEmail}, vous allez recevoir un code à 6 chiffres dans quelques instants. Vérifiez aussi vos spams.`
      );
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Impossible d'envoyer le code");
    } finally {
      setLoading(false);
    }
  };

  const submitReset = async () => {
    if (code.length !== 6) {
      showAlert("Code invalide", "Le code doit comporter 6 chiffres.");
      return;
    }
    if (newPassword.length < 8) {
      showAlert("Mot de passe trop court", "Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    setLoading(true);
    try {
      await api("/auth/reset-password", {
        method: "POST",
        body: { email: email.trim().toLowerCase(), code: code.trim(), new_password: newPassword },
      });
      showAlert(
        "✓ Mot de passe modifié",
        "Votre mot de passe a été mis à jour. Connectez-vous avec votre nouveau mot de passe.",
        () => router.replace("/auth/login")
      );
    } catch (e: any) {
      showAlert("Code incorrect", e?.message || "Le code est invalide ou a expiré.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="forgot-back">
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
          <Text style={styles.title}>Mot de passe oublié</Text>
          <View style={{ width: 26 }} />
        </View>

        <ScrollView contentContainerStyle={{ padding: spacing.lg }}>
          <View style={styles.iconCircle}>
            <Ionicons name={step === 1 ? "mail-outline" : "shield-checkmark"} size={36} color={colors.gold} />
          </View>

          {step === 1 ? (
            <>
              <Text style={styles.h1}>Réinitialisation</Text>
              <Text style={styles.h1Sub}>
                Entrez votre adresse email. Nous vous enverrons un code à 6 chiffres pour créer un nouveau mot de passe.
              </Text>

              <Text style={styles.label}>Adresse email</Text>
              <View style={styles.inputBox}>
                <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
                <TextInput
                  style={styles.input}
                  value={email}
                  onChangeText={setEmail}
                  placeholder="votre@email.com"
                  placeholderTextColor={colors.textSecondary}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="email-address"
                  testID="forgot-email"
                />
              </View>

              <TouchableOpacity style={styles.primaryBtn} onPress={requestCode} disabled={loading} testID="forgot-send-btn">
                {loading ? <ActivityIndicator color="#0A0A0A" /> : (
                  <>
                    <Ionicons name="paper-plane" size={18} color="#0A0A0A" />
                    <Text style={styles.primaryTxt}>Envoyer le code</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={() => router.replace("/auth/login")} style={styles.linkBtn}>
                <Text style={styles.linkTxt}>← Retour à la connexion</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.h1}>Code reçu ?</Text>
              <Text style={styles.h1Sub}>
                Entrez le code à 6 chiffres reçu par email et choisissez un nouveau mot de passe.
              </Text>

              <Text style={styles.label}>Code à 6 chiffres</Text>
              <View style={styles.inputBox}>
                <Ionicons name="keypad-outline" size={18} color={colors.textSecondary} />
                <TextInput
                  style={[styles.input, styles.codeInput]}
                  value={code}
                  onChangeText={(t) => setCode(t.replace(/\D/g, "").slice(0, 6))}
                  placeholder="123456"
                  placeholderTextColor={colors.textSecondary}
                  keyboardType="number-pad"
                  maxLength={6}
                  testID="forgot-code"
                />
              </View>

              <Text style={styles.label}>Nouveau mot de passe</Text>
              <View style={styles.inputBox}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
                <TextInput
                  style={styles.input}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Au moins 8 caractères"
                  placeholderTextColor={colors.textSecondary}
                  secureTextEntry={!showPassword}
                  autoCapitalize="none"
                  testID="forgot-newpw"
                />
                <TouchableOpacity onPress={() => setShowPassword((v) => !v)}>
                  <Ionicons name={showPassword ? "eye-off" : "eye"} size={18} color={colors.textSecondary} />
                </TouchableOpacity>
              </View>

              <TouchableOpacity style={styles.primaryBtn} onPress={submitReset} disabled={loading} testID="forgot-submit-btn">
                {loading ? <ActivityIndicator color="#0A0A0A" /> : (
                  <>
                    <Ionicons name="checkmark-circle" size={18} color="#0A0A0A" />
                    <Text style={styles.primaryTxt}>Valider le nouveau mot de passe</Text>
                  </>
                )}
              </TouchableOpacity>

              <TouchableOpacity onPress={() => { setStep(1); setCode(""); setNewPassword(""); }} style={styles.linkBtn}>
                <Text style={styles.linkTxt}>← Re-saisir l&apos;email</Text>
              </TouchableOpacity>

              <TouchableOpacity onPress={requestCode} style={styles.linkBtn} disabled={loading}>
                <Text style={[styles.linkTxt, { color: colors.gold }]}>Renvoyer un nouveau code</Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: "rgba(212,175,55,0.15)",
  },
  iconBtn: { padding: 6 },
  title: { color: colors.ivory, fontSize: 17, fontWeight: "700" },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36,
    alignSelf: "center", marginVertical: 24,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(212,175,55,0.12)",
    borderWidth: 1.5, borderColor: colors.gold,
  },
  h1: { color: colors.ivory, fontSize: 22, fontWeight: "800", textAlign: "center" },
  h1Sub: { color: colors.textSecondary, fontSize: 13, textAlign: "center", marginTop: 8, lineHeight: 18, paddingHorizontal: spacing.md, marginBottom: 28 },
  label: { color: colors.ivory, fontSize: 13, fontWeight: "600", marginBottom: 6, marginTop: 14 },
  inputBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: radii.md, borderWidth: 1, borderColor: "rgba(212,175,55,0.2)",
  },
  input: { flex: 1, color: colors.ivory, fontSize: 14 },
  codeInput: { letterSpacing: 4, fontSize: 18, fontWeight: "600", fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    backgroundColor: colors.gold, paddingVertical: 14, borderRadius: radii.md,
    marginTop: 28,
  },
  primaryTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 15 },
  linkBtn: { paddingVertical: 14, alignItems: "center" },
  linkTxt: { color: colors.textSecondary, fontSize: 13 },
});

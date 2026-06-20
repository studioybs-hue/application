/**
 * Change password screen — user changes their own password (requires current password).
 */
import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { auth as authApi } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { showAlert } from "@/src/utils/dialog";
import { colors, spacing, radii } from "@/src/theme";

export default function ChangePasswordScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [currentPwd, setCurrentPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  if (!user) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.muted}>Connectez-vous pour accéder à cette page.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const submit = async () => {
    setError("");
    if (!currentPwd) return setError("Saisissez votre mot de passe actuel.");
    if (newPwd.length < 6) return setError("Le nouveau mot de passe doit faire au moins 6 caractères.");
    if (newPwd !== confirmPwd) return setError("Les deux nouveaux mots de passe ne correspondent pas.");
    if (newPwd === currentPwd) return setError("Le nouveau mot de passe doit être différent de l'ancien.");
    setLoading(true);
    try {
      await authApi.changePassword(currentPwd, newPwd);
      showAlert("Mot de passe mis à jour", "Votre mot de passe a été changé avec succès.");
      setCurrentPwd("");
      setNewPwd("");
      setConfirmPwd("");
      router.back();
    } catch (e: any) {
      setError(e?.message || "Erreur");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back}>
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>

          <View style={styles.iconWrap}>
            <Ionicons name="lock-closed" size={56} color={colors.gold} />
          </View>
          <Text style={styles.title}>Changer mon mot de passe</Text>
          <Text style={styles.sub}>
            Choisissez un mot de passe fort, unique, et que vous n&apos;utilisez nulle part ailleurs.
          </Text>

          {/* Current password */}
          <View style={styles.field}>
            <Ionicons name="key-outline" size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.input}
              placeholder="Mot de passe actuel"
              placeholderTextColor={colors.textDisabled}
              secureTextEntry={!showCurrent}
              value={currentPwd}
              onChangeText={setCurrentPwd}
              autoCapitalize="none"
              testID="current-password"
            />
            <TouchableOpacity onPress={() => setShowCurrent(!showCurrent)}>
              <Ionicons
                name={showCurrent ? "eye-off-outline" : "eye-outline"}
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {/* New password */}
          <View style={styles.field}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.input}
              placeholder="Nouveau mot de passe (min. 6 caractères)"
              placeholderTextColor={colors.textDisabled}
              secureTextEntry={!showNew}
              value={newPwd}
              onChangeText={setNewPwd}
              autoCapitalize="none"
              testID="new-password"
            />
            <TouchableOpacity onPress={() => setShowNew(!showNew)}>
              <Ionicons
                name={showNew ? "eye-off-outline" : "eye-outline"}
                size={18}
                color={colors.textSecondary}
              />
            </TouchableOpacity>
          </View>

          {/* Confirm password */}
          <View style={styles.field}>
            <Ionicons name="checkmark-circle-outline" size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.input}
              placeholder="Confirmer le nouveau mot de passe"
              placeholderTextColor={colors.textDisabled}
              secureTextEntry={!showNew}
              value={confirmPwd}
              onChangeText={setConfirmPwd}
              autoCapitalize="none"
              testID="confirm-password"
            />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={submit}
            disabled={loading}
            testID="submit-change-password"
          >
            {loading ? (
              <ActivityIndicator color="#0A0A0A" />
            ) : (
              <Text style={styles.primaryTxt}>Mettre à jour le mot de passe</Text>
            )}
          </TouchableOpacity>

          <View style={styles.tips}>
            <Text style={styles.tipsTitle}>Conseils de sécurité :</Text>
            <Text style={styles.tipsTxt}>
              • Mélangez majuscules, minuscules, chiffres et symboles{"\n"}
              • Au moins 12 caractères pour une vraie sécurité{"\n"}
              • Ne réutilisez pas un mot de passe d&apos;un autre site{"\n"}
              • Utilisez un gestionnaire de mots de passe (Bitwarden, 1Password)
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
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
    marginBottom: spacing.xl,
    paddingHorizontal: spacing.md,
    lineHeight: 20,
  },
  muted: { color: colors.textSecondary, fontSize: 14 },
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
    gap: 10,
  },
  input: { flex: 1, color: colors.ivory, fontSize: 15 },
  error: { color: colors.error, marginTop: spacing.sm, fontSize: 13, textAlign: "center" },
  primaryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.gold,
    paddingVertical: 16,
    borderRadius: radii.sm,
    alignItems: "center",
  },
  primaryTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15, letterSpacing: 0.5 },
  tips: {
    marginTop: spacing.xl,
    backgroundColor: "rgba(212,175,55,0.06)",
    borderLeftWidth: 3,
    borderLeftColor: colors.gold,
    padding: spacing.md,
    borderRadius: 4,
  },
  tipsTitle: { color: colors.gold, fontSize: 13, fontWeight: "700", marginBottom: 6 },
  tipsTxt: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
});

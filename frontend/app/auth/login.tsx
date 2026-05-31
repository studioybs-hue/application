import { useState } from "react";
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
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radii } from "@/src/theme";
import { useAuth } from "@/src/auth/AuthContext";

export default function LoginScreen() {
  const router = useRouter();
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!email || !password) {
      setError("Veuillez remplir tous les champs");
      return;
    }
    setLoading(true);
    try {
      await login(email.trim().toLowerCase(), password);
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setError(e.message || "Erreur de connexion");
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
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="login-back">
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>

          <Text style={styles.brand}>CINÉMARIÉS</Text>
          <Text style={styles.tagline}>Le cinéma de votre plus beau jour</Text>
          <Text style={styles.title}>Connexion</Text>
          <Text style={styles.sub}>Accédez à vos films de mariage</Text>

          <View style={styles.field}>
            <Ionicons name="mail-outline" size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.input}
              placeholder="Adresse email"
              placeholderTextColor={colors.textDisabled}
              autoCapitalize="none"
              keyboardType="email-address"
              value={email}
              onChangeText={setEmail}
              testID="login-email-input"
            />
          </View>
          <View style={styles.field}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.input}
              placeholder="Mot de passe"
              placeholderTextColor={colors.textDisabled}
              secureTextEntry={!show}
              value={password}
              onChangeText={setPassword}
              testID="login-password-input"
            />
            <TouchableOpacity onPress={() => setShow(!show)}>
              <Ionicons name={show ? "eye-off-outline" : "eye-outline"} size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {error ? <Text style={styles.error} testID="login-error">{error}</Text> : null}

          <TouchableOpacity style={styles.primaryBtn} onPress={submit} disabled={loading} testID="login-submit-btn">
            {loading ? <ActivityIndicator color="#0A0A0A" /> : <Text style={styles.primaryTxt}>Se connecter</Text>}
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.forgotBtn}
            onPress={() => router.push("/auth/forgot-password")}
            testID="login-forgot-password"
          >
            <Text style={styles.forgotTxt}>Mot de passe oublié ?</Text>
          </TouchableOpacity>

          <View style={styles.divider}>
            <View style={styles.line} />
            <Text style={styles.dividerTxt}>ou</Text>
            <View style={styles.line} />
          </View>

          <TouchableOpacity
            style={styles.secondaryBtn}
            onPress={() => router.push("/auth/register")}
            testID="login-go-register"
          >
            <Text style={styles.secondaryTxt}>Créer un compte</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, paddingTop: spacing.lg },
  back: { width: 40, height: 40, alignItems: "flex-start", justifyContent: "center" },
  brand: { color: colors.gold, fontSize: 24, letterSpacing: 6, fontWeight: "700", marginTop: spacing.lg },
  tagline: { color: colors.ivory, fontSize: 11, letterSpacing: 2, fontStyle: "italic", marginTop: 4, opacity: 0.8 },
  title: { color: colors.ivory, fontSize: 32, fontWeight: "700", marginTop: spacing.md },
  sub: { color: colors.textSecondary, fontSize: 14, marginTop: 4, marginBottom: spacing.xl },
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
  error: { color: colors.error, marginTop: 4, marginBottom: 4, fontSize: 13 },
  primaryBtn: {
    marginTop: spacing.md,
    backgroundColor: colors.gold,
    paddingVertical: 16,
    borderRadius: radii.sm,
    alignItems: "center",
  },
  primaryTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15, letterSpacing: 0.5 },
  forgotBtn: { paddingVertical: 12, alignItems: "center", marginTop: 4 },
  forgotTxt: { color: colors.gold, fontSize: 13, fontWeight: "600" },
  divider: { flexDirection: "row", alignItems: "center", marginVertical: spacing.lg, gap: 12 },
  line: { flex: 1, height: 1, backgroundColor: "rgba(255,255,255,0.1)" },
  dividerTxt: { color: colors.textSecondary, fontSize: 12 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 16,
    borderRadius: radii.sm,
    alignItems: "center",
  },
  secondaryTxt: { color: colors.gold, fontWeight: "600", fontSize: 15 },
});

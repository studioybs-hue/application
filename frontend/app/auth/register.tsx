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

export default function RegisterScreen() {
  const router = useRouter();
  const { register } = useAuth();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!name || !email || !password) {
      setError("Veuillez remplir tous les champs");
      return;
    }
    if (password.length < 6) {
      setError("Le mot de passe doit contenir au moins 6 caractères");
      return;
    }
    setLoading(true);
    try {
      await register(email.trim().toLowerCase(), password, name.trim());
      router.replace("/(tabs)/home");
    } catch (e: any) {
      setError(e.message || "Erreur lors de l'inscription");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="register-back">
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
          <Text style={styles.brand}>CINÉMARIÉS</Text>
          <Text style={styles.tagline}>Le cinéma de votre plus beau jour</Text>
          <Text style={styles.title}>Créer un compte</Text>
          <Text style={styles.sub}>Rejoignez la plateforme de streaming dédiée aux mariages</Text>

          <View style={styles.field}>
            <Ionicons name="person-outline" size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.input}
              placeholder="Nom complet"
              placeholderTextColor={colors.textDisabled}
              value={name}
              onChangeText={setName}
              testID="register-name-input"
            />
          </View>
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
              testID="register-email-input"
            />
          </View>
          <View style={styles.field}>
            <Ionicons name="lock-closed-outline" size={18} color={colors.textSecondary} />
            <TextInput
              style={styles.input}
              placeholder="Mot de passe (min. 6 caractères)"
              placeholderTextColor={colors.textDisabled}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              testID="register-password-input"
            />
          </View>

          {error ? <Text style={styles.error} testID="register-error">{error}</Text> : null}

          <TouchableOpacity style={styles.primaryBtn} onPress={submit} disabled={loading} testID="register-submit-btn">
            {loading ? <ActivityIndicator color="#0A0A0A" /> : <Text style={styles.primaryTxt}>S&apos;inscrire</Text>}
          </TouchableOpacity>

          <TouchableOpacity onPress={() => router.replace("/auth/login")} style={styles.linkRow} testID="register-go-login">
            <Text style={styles.linkTxt}>
              Déjà un compte ? <Text style={{ color: colors.gold, fontWeight: "700" }}>Connexion</Text>
            </Text>
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
  title: { color: colors.ivory, fontSize: 30, fontWeight: "700", marginTop: spacing.md },
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
  linkRow: { alignItems: "center", marginTop: spacing.lg },
  linkTxt: { color: colors.textSecondary, fontSize: 14 },
});

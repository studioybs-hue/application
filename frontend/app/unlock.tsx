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
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { colors, spacing, radii } from "@/src/theme";
import { useAuth } from "@/src/auth/AuthContext";
import { api } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { getDeviceId, getDeviceLabel } from "@/src/utils/deviceId";
import { showAlert } from "@/src/utils/dialog";

const CODES_KEY = "ws_unlocked_codes"; // same key as wedding/[clientId].tsx

async function saveCode(clientId: string, code: string) {
  const raw = await storage.getItem<string>(CODES_KEY, "{}");
  let map: Record<string, string> = {};
  try { map = JSON.parse(raw || "{}"); } catch {}
  map[clientId] = code;
  await storage.setItem(CODES_KEY, JSON.stringify(map));
}

export default function UnlockScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    const clean = code.trim().toUpperCase();
    if (clean.length < 4) {
      setError("Code invalide");
      return;
    }
    setLoading(true);
    try {
      const device_id = await getDeviceId();
      const device_label = getDeviceLabel();
      const r = await api<{ ok: boolean; client_id: string; client_name: string; video_count: number }>("/weddings/unlock", {
        method: "POST",
        body: { code: clean, device_id, device_label },
      });
      // Persist the code locally so future visits/refresh keep the wedding unlocked.
      await saveCode(r.client_id, clean);
      // Go straight to the wedding space — no need for a confirmation modal on web (it would block).
      router.replace(`/wedding/${r.client_id}`);
    } catch (e: any) {
      setError(e.message || "Code invalide");
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.root}>
      <LinearGradient
        colors={["#1F0A0F", colors.bg]}
        style={StyleSheet.absoluteFillObject}
      />
      <SafeAreaView style={{ flex: 1 }}>
        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
          <View style={styles.header}>
            <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="unlock-back">
              <Ionicons name="close" size={26} color={colors.ivory} />
            </TouchableOpacity>
          </View>

          <View style={styles.content}>
            <View style={styles.lockCircle}>
              <Ionicons name="key" size={36} color={colors.gold} />
            </View>
            <Text style={styles.title}>Code de déblocage</Text>
            <Text style={styles.sub}>
              Entrez le code unique fourni par votre vidéaste pour accéder à votre film de mariage.
              {"\n"}
              <Text style={{ color: colors.textDisabled, fontSize: 12, fontStyle: "italic" }}>
                Pas besoin de compte — utilisable sur 3 appareils maximum.
              </Text>
            </Text>

            <View style={styles.codeField}>
              <TextInput
                style={styles.codeInput}
                placeholder="XXXXXXXX"
                placeholderTextColor={colors.textDisabled}
                value={code}
                onChangeText={(t) => setCode(t.toUpperCase().slice(0, 12))}
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={12}
                textAlign="center"
                testID="unlock-code-input"
              />
            </View>

            {error ? <Text style={styles.error} testID="unlock-error">{error}</Text> : null}

            <TouchableOpacity
              style={styles.btn}
              onPress={submit}
              disabled={loading}
              testID="unlock-submit-btn"
            >
              {loading ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <Text style={styles.btnTxt}>Débloquer ma vidéo</Text>
              )}
            </TouchableOpacity>

            <View style={styles.help}>
              <Ionicons name="information-circle-outline" size={16} color={colors.textSecondary} />
              <Text style={styles.helpTxt}>
                Vous n&apos;avez pas reçu votre code ? Contactez votre vidéaste de mariage.
              </Text>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  back: { width: 44, height: 44, alignItems: "flex-start", justifyContent: "center" },
  content: { flex: 1, padding: spacing.lg, alignItems: "center", justifyContent: "center" },
  lockCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1.5,
    borderColor: colors.gold,
    backgroundColor: "rgba(212,175,55,0.08)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: { color: colors.ivory, fontSize: 28, fontWeight: "700", textAlign: "center" },
  sub: {
    color: colors.textSecondary,
    fontSize: 14,
    textAlign: "center",
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    lineHeight: 20,
  },
  codeField: {
    width: "100%",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: 18,
    marginBottom: spacing.md,
  },
  codeInput: {
    color: colors.ivory,
    fontSize: 28,
    letterSpacing: 8,
    fontWeight: "700",
  },
  error: { color: colors.error, marginBottom: spacing.sm },
  btn: {
    width: "100%",
    backgroundColor: colors.gold,
    paddingVertical: 16,
    borderRadius: radii.sm,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  btnTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15, letterSpacing: 0.5 },
  help: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: spacing.xl, paddingHorizontal: spacing.md },
  helpTxt: { color: colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 18 },
});

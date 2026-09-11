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
import { LinearGradient } from "expo-linear-gradient";
import { colors, spacing, radii } from "@/src/theme";
import { useAuth } from "@/src/auth/AuthContext";
import { api } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { getDeviceId, getDeviceLabel } from "@/src/utils/deviceId";
import { IS_IOS_NATIVE } from "@/src/utils/platform";
import IOSReaderGate from "@/src/ui/IOSReaderGate";

const CODES_KEY = "ws_unlocked_codes"; // same key as wedding/[clientId].tsx

type AvailableWedding = { client_id: string; name: string };

async function saveCode(clientId: string, code: string) {
  const raw = await storage.getItem<string>(CODES_KEY, "{}");
  let map: Record<string, string> = {};
  try { map = JSON.parse(raw || "{}"); } catch {}
  map[clientId] = code;
  await storage.setItem(CODES_KEY, JSON.stringify(map));
}

export default function UnlockScreen() {
  const router = useRouter();
  const { refresh: refreshAuth } = useAuth();
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [availableWeddings, setAvailableWeddings] = useState<AvailableWedding[] | null>(null);

  // === App Store Guideline 3.1.1 — Reader App ===
  // Apple forbids unlocking digital content via codes inside the iOS app.
  // Family/guests must enter their code on cinemaries.fr; once their account is linked,
  // the wedding becomes available in this app on next login.
  if (IS_IOS_NATIVE) {
    return (
      <IOSReaderGate
        title="Saisie de code sur le web"
        message="L'activation de votre code d'accès se fait sur cinemaries.fr depuis votre navigateur."
        hint="Une fois votre code activé sur le web, reconnectez-vous ici : le mariage apparaîtra automatiquement."
      />
    );
  }

  const submit = async (clientIdOverride?: string) => {
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
      const body: Record<string, any> = { code: clean, device_id, device_label };
      if (clientIdOverride) body.client_id = clientIdOverride;
      const r = await api<{
        ok: boolean;
        client_id: string;
        client_name?: string;
        video_count?: number;
        auto_assigned?: boolean;
        master?: boolean;
      }>("/weddings/unlock", { method: "POST", body });
      // Persist the code locally so future visits/refresh keep the wedding unlocked.
      await saveCode(r.client_id, clean);
      if (r.auto_assigned) {
        try { await refreshAuth(); } catch {}
      }
      setAvailableWeddings(null);
      router.replace(`/wedding/${r.client_id}`);
    } catch (e: any) {
      // Special handling for master code: backend returns 422 with available_weddings list
      const detail = e?.detail;
      if (
        detail &&
        typeof detail === "object" &&
        Array.isArray(detail.available_weddings) &&
        detail.available_weddings.length > 0
      ) {
        setAvailableWeddings(detail.available_weddings as AvailableWedding[]);
        setError("");
      } else {
        setAvailableWeddings(null);
        setError(e?.message || "Code invalide");
      }
    } finally {
      setLoading(false);
    }
  };

  // When the user picks a wedding after master-code recognition
  const pickWedding = (cid: string) => {
    submit(cid);
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
            <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} style={styles.back} testID="unlock-back">
              <Ionicons name="close" size={26} color={colors.ivory} />
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <View style={styles.lockCircle}>
              <Ionicons name={availableWeddings ? "albums" : "key"} size={36} color={colors.gold} />
            </View>

            {availableWeddings ? (
              <>
                <Text style={styles.title}>Choisir un mariage</Text>
                <Text style={styles.sub}>
                  Code maître reconnu. Sélectionnez le mariage à débloquer.
                </Text>

                <View style={styles.weddingsList}>
                  {availableWeddings.map((w) => (
                    <TouchableOpacity
                      key={w.client_id}
                      style={styles.weddingItem}
                      onPress={() => pickWedding(w.client_id)}
                      disabled={loading}
                      testID={`pick-wedding-${w.client_id}`}
                    >
                      <View style={styles.weddingIcon}>
                        <Ionicons name="heart" size={18} color={colors.gold} />
                      </View>
                      <Text style={styles.weddingName} numberOfLines={1}>
                        {w.name || w.client_id}
                      </Text>
                      <Ionicons name="chevron-forward" size={20} color={colors.textSecondary} />
                    </TouchableOpacity>
                  ))}
                </View>

                {loading ? <ActivityIndicator color={colors.gold} style={{ marginTop: 16 }} /> : null}

                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={() => { setAvailableWeddings(null); setCode(""); }}
                  testID="unlock-back-to-code"
                >
                  <Text style={styles.secondaryBtnTxt}>← Saisir un autre code</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
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
                  onPress={() => submit()}
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
              </>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  back: { width: 44, height: 44, alignItems: "flex-start", justifyContent: "center" },
  content: { flexGrow: 1, padding: spacing.lg, alignItems: "center", justifyContent: "center" },
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
  error: { color: colors.error, marginBottom: spacing.sm, textAlign: "center" },
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

  // Wedding picker (master-code mode)
  weddingsList: { width: "100%", gap: 10, marginBottom: spacing.lg },
  weddingItem: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    paddingVertical: 14,
    paddingHorizontal: 14,
    gap: 12,
  },
  weddingIcon: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: "rgba(212,175,55,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  weddingName: { flex: 1, color: colors.ivory, fontSize: 15, fontWeight: "600" },

  secondaryBtn: { marginTop: spacing.md, paddingVertical: 10 },
  secondaryBtnTxt: { color: colors.textSecondary, fontSize: 13, fontWeight: "500" },
});

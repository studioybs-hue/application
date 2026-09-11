import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Switch,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";

type SmtpCfg = {
  host: string;
  port: number;
  user: string;
  password_mask: string;
  password_set: boolean;
  from_email: string;
  from_name: string;
  use_ssl: boolean;
};

type BrevoCfg = {
  sender: string;
  api_key_mask: string;
  api_key_set: boolean;
};

export default function AdminSettings() {
  const router = useRouter();
  const [tab, setTab] = useState<"smtp" | "sms">("smtp");

  // SMTP form
  const [smtp, setSmtp] = useState<SmtpCfg | null>(null);
  const [smtpForm, setSmtpForm] = useState({
    host: "",
    port: "465",
    user: "",
    password: "",
    from_email: "",
    from_name: "CINÉMARIÉS",
    use_ssl: true,
  });
  const [smtpTestTo, setSmtpTestTo] = useState("");
  const [savingSmtp, setSavingSmtp] = useState(false);
  const [testingSmtp, setTestingSmtp] = useState(false);

  // Brevo form
  const [brevo, setBrevo] = useState<BrevoCfg | null>(null);
  const [brevoForm, setBrevoForm] = useState({ sender: "CINEMARIES", api_key: "" });
  const [brevoTestTo, setBrevoTestTo] = useState("");
  const [savingBrevo, setSavingBrevo] = useState(false);
  const [testingBrevo, setTestingBrevo] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, b] = await Promise.all([
        api<SmtpCfg>("/admin/settings/smtp"),
        api<BrevoCfg>("/admin/settings/brevo-sms"),
      ]);
      setSmtp(s);
      setSmtpForm({
        host: s.host || "smtp.ionos.fr",
        port: String(s.port || 465),
        user: s.user || "",
        password: "",
        from_email: s.from_email || "",
        from_name: s.from_name || "CINÉMARIÉS",
        use_ssl: s.use_ssl,
      });
      setSmtpTestTo(s.from_email || "");
      setBrevo(b);
      setBrevoForm({ sender: b.sender || "CINEMARIES", api_key: "" });
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Impossible de charger");
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const saveSmtp = async () => {
    if (!smtpForm.host || !smtpForm.user || !smtpForm.from_email) {
      Alert.alert("Champs requis", "Serveur, utilisateur et expéditeur sont requis.");
      return;
    }
    setSavingSmtp(true);
    try {
      const body: any = {
        host: smtpForm.host.trim(),
        port: parseInt(smtpForm.port, 10) || 465,
        user: smtpForm.user.trim(),
        from_email: smtpForm.from_email.trim(),
        from_name: smtpForm.from_name.trim() || "CINÉMARIÉS",
        use_ssl: smtpForm.use_ssl,
      };
      if (smtpForm.password.trim()) body.password = smtpForm.password.trim();
      const updated = await api<SmtpCfg>("/admin/settings/smtp", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setSmtp(updated);
      setSmtpForm({ ...smtpForm, password: "" });
      Alert.alert("Enregistré", "Configuration SMTP mise à jour.");
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Impossible d'enregistrer");
    } finally {
      setSavingSmtp(false);
    }
  };

  const testSmtp = async () => {
    if (!smtpTestTo.trim()) {
      Alert.alert("Email requis", "Renseignez une adresse email pour le test.");
      return;
    }
    setTestingSmtp(true);
    try {
      const r = await api<{ ok: boolean; error?: string }>(
        "/admin/settings/smtp/test",
        { method: "POST", body: JSON.stringify({ to: smtpTestTo.trim() }) }
      );
      if (r.ok) {
        Alert.alert("✅ Envoyé", `Email de test envoyé à ${smtpTestTo}. Vérifiez la boîte de réception.`);
      } else {
        Alert.alert("❌ Échec", r.error || "Envoi échoué. Vérifiez les identifiants.");
      }
    } catch (e: any) {
      Alert.alert("❌ Échec", e?.message || "Erreur d'envoi");
    } finally {
      setTestingSmtp(false);
    }
  };

  const saveBrevo = async () => {
    if (!brevoForm.sender.trim()) {
      Alert.alert("Sender requis", "L'expéditeur SMS est obligatoire (max 11 caractères).");
      return;
    }
    setSavingBrevo(true);
    try {
      const body: any = { sender: brevoForm.sender.trim().slice(0, 11) };
      if (brevoForm.api_key.trim()) body.api_key = brevoForm.api_key.trim();
      const updated = await api<BrevoCfg>("/admin/settings/brevo-sms", {
        method: "PUT",
        body: JSON.stringify(body),
      });
      setBrevo(updated);
      setBrevoForm({ ...brevoForm, api_key: "" });
      Alert.alert("Enregistré", "Configuration SMS Brevo mise à jour.");
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Impossible d'enregistrer");
    } finally {
      setSavingBrevo(false);
    }
  };

  const testBrevo = async () => {
    if (!brevoTestTo.trim()) {
      Alert.alert("Numéro requis", "Renseignez un numéro FR pour le test.");
      return;
    }
    setTestingBrevo(true);
    try {
      const r = await api<{ ok: boolean; info: string; to_e164?: string }>(
        "/admin/settings/brevo-sms/test",
        {
          method: "POST",
          body: JSON.stringify({
            to: brevoTestTo.trim(),
            message: "CINEMARIES: test SMS depuis l'admin.",
          }),
        }
      );
      if (r.ok) {
        Alert.alert("✅ Envoyé", `SMS de test envoyé à ${r.to_e164}. Message ID: ${r.info}`);
      } else {
        Alert.alert("❌ Échec", `Envoi échoué: ${r.info}`);
      }
    } catch (e: any) {
      Alert.alert("❌ Échec", e?.message || "Erreur d'envoi");
    } finally {
      setTestingBrevo(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} testID="settings-back">
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Paramètres</Text>
        <View style={{ width: 26 }} />
      </View>

      {/* Tabs */}
      <View style={styles.tabs}>
        <TouchableOpacity
          style={[styles.tab, tab === "smtp" && styles.tabActive]}
          onPress={() => setTab("smtp")}
          testID="tab-smtp"
        >
          <Ionicons name="mail" size={16} color={tab === "smtp" ? colors.gold : colors.textSecondary} />
          <Text style={[styles.tabText, tab === "smtp" && styles.tabTextActive]}>Email SMTP</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, tab === "sms" && styles.tabActive]}
          onPress={() => setTab("sms")}
          testID="tab-sms"
        >
          <Ionicons name="chatbubble" size={16} color={tab === "sms" ? colors.gold : colors.textSecondary} />
          <Text style={[styles.tabText, tab === "sms" && styles.tabTextActive]}>SMS Brevo</Text>
        </TouchableOpacity>
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl * 3 }}
          keyboardShouldPersistTaps="handled"
        >
          {tab === "smtp" && (
            <>
              {!smtp ? (
                <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} />
              ) : (
                <>
                  <View style={styles.statusBox}>
                    <Ionicons
                      name={smtp.password_set ? "checkmark-circle" : "alert-circle"}
                      size={18}
                      color={smtp.password_set ? "#4ADE80" : colors.gold}
                    />
                    <Text style={styles.statusText}>
                      {smtp.password_set
                        ? `Mot de passe actuel : ${smtp.password_mask}`
                        : "Aucun mot de passe configuré"}
                    </Text>
                  </View>

                  <Text style={styles.label}>Serveur SMTP</Text>
                  <TextInput
                    style={styles.input}
                    value={smtpForm.host}
                    onChangeText={(t) => setSmtpForm({ ...smtpForm, host: t })}
                    placeholder="smtp.ionos.fr"
                    placeholderTextColor={colors.textDisabled}
                    autoCapitalize="none"
                    testID="smtp-host"
                  />

                  <View style={{ flexDirection: "row", gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.label}>Port</Text>
                      <TextInput
                        style={styles.input}
                        value={smtpForm.port}
                        onChangeText={(t) => setSmtpForm({ ...smtpForm, port: t.replace(/[^0-9]/g, "") })}
                        placeholder="465"
                        placeholderTextColor={colors.textDisabled}
                        keyboardType="number-pad"
                        testID="smtp-port"
                      />
                    </View>
                    <View style={styles.sslWrap}>
                      <Text style={styles.label}>SSL/TLS</Text>
                      <View style={styles.switchRow}>
                        <Switch
                          value={smtpForm.use_ssl}
                          onValueChange={(v) => setSmtpForm({ ...smtpForm, use_ssl: v })}
                          trackColor={{ true: colors.gold, false: "#333" }}
                          thumbColor="#0A0A0A"
                          testID="smtp-ssl"
                        />
                        <Text style={styles.switchLabel}>{smtpForm.use_ssl ? "Activé" : "STARTTLS"}</Text>
                      </View>
                    </View>
                  </View>

                  <Text style={styles.label}>Nom utilisateur</Text>
                  <TextInput
                    style={styles.input}
                    value={smtpForm.user}
                    onChangeText={(t) => setSmtpForm({ ...smtpForm, user: t })}
                    placeholder="contact@cinemaries.fr"
                    placeholderTextColor={colors.textDisabled}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    testID="smtp-user"
                  />

                  <Text style={styles.label}>
                    Mot de passe {smtp.password_set ? "(laisser vide pour conserver l'actuel)" : ""}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={smtpForm.password}
                    onChangeText={(t) => setSmtpForm({ ...smtpForm, password: t })}
                    placeholder={smtp.password_set ? smtp.password_mask : "Nouveau mot de passe"}
                    placeholderTextColor={colors.textDisabled}
                    secureTextEntry
                    autoCapitalize="none"
                    testID="smtp-password"
                  />

                  <Text style={styles.label}>Email expéditeur</Text>
                  <TextInput
                    style={styles.input}
                    value={smtpForm.from_email}
                    onChangeText={(t) => setSmtpForm({ ...smtpForm, from_email: t })}
                    placeholder="contact@cinemaries.fr"
                    placeholderTextColor={colors.textDisabled}
                    autoCapitalize="none"
                    keyboardType="email-address"
                    testID="smtp-from-email"
                  />

                  <Text style={styles.label}>Nom expéditeur</Text>
                  <TextInput
                    style={styles.input}
                    value={smtpForm.from_name}
                    onChangeText={(t) => setSmtpForm({ ...smtpForm, from_name: t })}
                    placeholder="CINÉMARIÉS"
                    placeholderTextColor={colors.textDisabled}
                    testID="smtp-from-name"
                  />

                  <TouchableOpacity
                    style={[styles.btnPrimary, savingSmtp && { opacity: 0.5 }]}
                    onPress={saveSmtp}
                    disabled={savingSmtp}
                    testID="smtp-save"
                  >
                    {savingSmtp ? (
                      <ActivityIndicator color="#0A0A0A" />
                    ) : (
                      <Text style={styles.btnPrimaryText}>Enregistrer</Text>
                    )}
                  </TouchableOpacity>

                  {/* Test section */}
                  <View style={styles.testBox}>
                    <Text style={styles.testTitle}>Tester la configuration</Text>
                    <TextInput
                      style={styles.input}
                      value={smtpTestTo}
                      onChangeText={setSmtpTestTo}
                      placeholder="votre@email.fr"
                      placeholderTextColor={colors.textDisabled}
                      autoCapitalize="none"
                      keyboardType="email-address"
                      testID="smtp-test-to"
                    />
                    <TouchableOpacity
                      style={[styles.btnGhost, testingSmtp && { opacity: 0.5 }]}
                      onPress={testSmtp}
                      disabled={testingSmtp}
                      testID="smtp-test-send"
                    >
                      {testingSmtp ? (
                        <ActivityIndicator color={colors.gold} />
                      ) : (
                        <Text style={styles.btnGhostText}>Envoyer un email de test</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </>
          )}

          {tab === "sms" && (
            <>
              {!brevo ? (
                <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} />
              ) : (
                <>
                  <View style={styles.statusBox}>
                    <Ionicons
                      name={brevo.api_key_set ? "checkmark-circle" : "alert-circle"}
                      size={18}
                      color={brevo.api_key_set ? "#4ADE80" : colors.gold}
                    />
                    <Text style={styles.statusText}>
                      {brevo.api_key_set
                        ? `Clé API configurée`
                        : "Aucune clé API configurée"}
                    </Text>
                  </View>

                  <Text style={styles.label}>
                    Clé API Brevo {brevo.api_key_set ? "(laisser vide pour conserver l'actuelle)" : ""}
                  </Text>
                  <TextInput
                    style={styles.input}
                    value={brevoForm.api_key}
                    onChangeText={(t) => setBrevoForm({ ...brevoForm, api_key: t })}
                    placeholder={brevo.api_key_set ? "xkeysib-•••" : "xkeysib-..."}
                    placeholderTextColor={colors.textDisabled}
                    secureTextEntry
                    autoCapitalize="none"
                    testID="brevo-api-key"
                  />

                  <Text style={styles.label}>Sender ID (11 caractères max, alphanumérique)</Text>
                  <TextInput
                    style={styles.input}
                    value={brevoForm.sender}
                    onChangeText={(t) => setBrevoForm({ ...brevoForm, sender: t.replace(/[^A-Za-z0-9]/g, "").slice(0, 11) })}
                    placeholder="CINEMARIES"
                    placeholderTextColor={colors.textDisabled}
                    autoCapitalize="characters"
                    testID="brevo-sender"
                  />
                  <Text style={styles.hint}>
                    ⚠️ Un Sender ID doit être validé côté Brevo pour l'envoi en France (peut prendre 1-2 jours).
                  </Text>

                  <TouchableOpacity
                    style={[styles.btnPrimary, savingBrevo && { opacity: 0.5 }]}
                    onPress={saveBrevo}
                    disabled={savingBrevo}
                    testID="brevo-save"
                  >
                    {savingBrevo ? (
                      <ActivityIndicator color="#0A0A0A" />
                    ) : (
                      <Text style={styles.btnPrimaryText}>Enregistrer</Text>
                    )}
                  </TouchableOpacity>

                  <View style={styles.testBox}>
                    <Text style={styles.testTitle}>Tester la configuration</Text>
                    <TextInput
                      style={styles.input}
                      value={brevoTestTo}
                      onChangeText={setBrevoTestTo}
                      placeholder="06XXXXXXXX"
                      placeholderTextColor={colors.textDisabled}
                      keyboardType="phone-pad"
                      testID="brevo-test-to"
                    />
                    <TouchableOpacity
                      style={[styles.btnGhost, testingBrevo && { opacity: 0.5 }]}
                      onPress={testBrevo}
                      disabled={testingBrevo}
                      testID="brevo-test-send"
                    >
                      {testingBrevo ? (
                        <ActivityIndicator color={colors.gold} />
                      ) : (
                        <Text style={styles.btnGhostText}>Envoyer un SMS de test</Text>
                      )}
                    </TouchableOpacity>
                  </View>
                </>
              )}
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.gold, fontSize: 16, fontWeight: "800", letterSpacing: 1 },
  tabs: {
    flexDirection: "row",
    padding: spacing.sm,
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  tab: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: "transparent",
  },
  tabActive: {
    borderColor: colors.gold,
    backgroundColor: "rgba(212,175,55,0.10)",
  },
  tabText: { color: colors.textSecondary, fontSize: 13, fontWeight: "600" },
  tabTextActive: { color: colors.gold },

  statusBox: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  statusText: { color: colors.ivory, fontSize: 13, flex: 1 },

  label: {
    color: colors.ivory,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.md,
    marginBottom: 6,
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: 12,
    color: colors.ivory,
    fontSize: 14,
  },
  hint: { color: colors.textSecondary, fontSize: 11, marginTop: 4, fontStyle: "italic" },
  sslWrap: { flex: 1 },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 8,
    gap: 8,
    height: 46,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
  },
  switchLabel: { color: colors.ivory, fontSize: 13 },

  btnPrimary: {
    backgroundColor: colors.gold,
    paddingVertical: 14,
    borderRadius: radii.sm,
    alignItems: "center",
    marginTop: spacing.lg,
  },
  btnPrimaryText: { color: "#0A0A0A", fontWeight: "800", fontSize: 14 },
  btnGhost: {
    borderWidth: 1,
    borderColor: colors.gold,
    paddingVertical: 12,
    borderRadius: radii.sm,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  btnGhostText: { color: colors.gold, fontWeight: "700", fontSize: 13 },

  testBox: {
    marginTop: spacing.xl,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: "rgba(212,175,55,0.05)",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.20)",
    borderStyle: "dashed",
  },
  testTitle: {
    color: colors.gold,
    fontSize: 13,
    fontWeight: "700",
    marginBottom: spacing.sm,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});

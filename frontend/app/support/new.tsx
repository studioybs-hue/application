/** Create a new support ticket */
import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { showAlert } from "@/src/utils/dialog";
import { colors, spacing, radii } from "@/src/theme";
import { Ticket } from "@/src/support/types";

const PRESETS = [
  "Problème de lecture vidéo",
  "Code de mariage invalide",
  "Question sur l'abonnement Premium",
  "Demande d'hébergement vidéo",
  "Bug ou erreur dans l'app",
  "Autre",
];

export default function NewTicket() {
  const router = useRouter();
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const s = subject.trim();
    if (!s) {
      showAlert("Erreur", "Choisissez un sujet pour votre demande.");
      return;
    }
    if (!message.trim()) {
      showAlert("Erreur", "Décrivez votre demande pour que nous puissions vous aider.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await api<{ ticket: Ticket }>("/support/tickets", {
        method: "POST",
        body: { subject: s, initial_message: message.trim() },
      });
      router.replace(`/support/${r.ticket.id}`);
    } catch (e: any) {
      showAlert("Erreur", e.message || "Impossible de créer le ticket");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()}>
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Nouvelle demande</Text>
          <View style={{ width: 26 }} />
        </View>
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}>
          <Text style={styles.label}>Sujet *</Text>
          <View style={styles.chips}>
            {PRESETS.map((p) => (
              <TouchableOpacity
                key={p}
                style={[styles.chip, subject === p && styles.chipActive]}
                onPress={() => setSubject(p)}
                testID={`subject-preset-${p}`}
              >
                <Text style={[styles.chipTxt, subject === p && { color: "#0A0A0A", fontWeight: "700" }]}>{p}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TextInput
            style={styles.input}
            value={subject}
            onChangeText={setSubject}
            placeholder="Ou tapez votre sujet…"
            placeholderTextColor={colors.textDisabled}
            maxLength={140}
            testID="subject-input"
          />
          <Text style={styles.charCount}>{subject.length}/140</Text>

          <Text style={[styles.label, { marginTop: 16 }]}>Votre message *</Text>
          <TextInput
            style={[styles.input, { minHeight: 140, textAlignVertical: "top" }]}
            value={message}
            onChangeText={setMessage}
            placeholder="Décrivez votre demande en détail (vous pourrez aussi joindre des photos après la création)."
            placeholderTextColor={colors.textDisabled}
            multiline
            maxLength={4000}
            testID="message-input"
          />
          <Text style={styles.charCount}>{message.length}/4000</Text>

          <TouchableOpacity
            style={[styles.submitBtn, submitting && { opacity: 0.5 }]}
            onPress={submit}
            disabled={submitting}
            testID="submit-ticket-btn"
          >
            {submitting ? (
              <ActivityIndicator color="#0A0A0A" />
            ) : (
              <Text style={styles.submitTxt}>Envoyer ma demande</Text>
            )}
          </TouchableOpacity>
          <Text style={styles.hint}>
            🔒 Notre équipe vous répondra rapidement. Vous serez notifié par push et par email.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 10 },
  headerTitle: { flex: 1, color: colors.ivory, fontSize: 18, fontWeight: "700", textAlign: "center" },
  label: { color: colors.textSecondary, fontSize: 12, marginBottom: 8, letterSpacing: 0.5, textTransform: "uppercase" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipTxt: { color: colors.ivory, fontSize: 12 },
  input: { backgroundColor: colors.surface, color: colors.ivory, borderRadius: radii.sm, paddingHorizontal: 14, paddingVertical: 14, fontSize: 14, borderWidth: 1, borderColor: colors.border },
  charCount: { color: colors.textDisabled, fontSize: 10, textAlign: "right", marginTop: 4 },
  submitBtn: { backgroundColor: colors.gold, paddingVertical: 16, borderRadius: radii.sm, alignItems: "center", marginTop: 24 },
  submitTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15, letterSpacing: 0.5 },
  hint: { color: colors.textSecondary, fontSize: 11, textAlign: "center", marginTop: 14, fontStyle: "italic" },
});

/**
 * NotifyPanel — Admin UI to send push + email notifications to a wedding's owners (and optionally guests)
 * when a video is uploaded or updated.
 *
 * Used inside /app/admin/video-edit/[id].tsx
 */
import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  ActivityIndicator,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { showAlert } from "@/src/utils/dialog";
import { colors, spacing, radii } from "@/src/theme";

type Recipients = {
  video_title: string;
  client_name?: string;
  client_id: string;
  owners: number;
  guests: number;
  push_devices: number;
  emails: number;
};

const DEFAULT_TITLE = "🎬 Votre film est en ligne !";
const DEFAULT_BODY_FN = (name: string) =>
  `${name} — Le film de votre plus beau jour vous attend dans CINÉMARIÉS. Ouvrez l'app pour le regarder.`;

export function NotifyPanel({ videoId, clientName }: { videoId: string; clientName?: string }) {
  const [includeGuests, setIncludeGuests] = useState(false);
  const [sendPush, setSendPush] = useState(true);
  const [sendEmail, setSendEmail] = useState(true);
  const [title, setTitle] = useState(DEFAULT_TITLE);
  const [body, setBody] = useState(DEFAULT_BODY_FN(clientName || "Votre mariage"));
  const [recipients, setRecipients] = useState<Recipients | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmStep, setConfirmStep] = useState(false);

  const loadRecipients = async (withGuests: boolean) => {
    setLoadingPreview(true);
    try {
      const r = await api<Recipients>(
        `/admin/videos/${videoId}/notify-recipients?include_guests=${withGuests}`
      );
      setRecipients(r);
    } catch (e: any) {
      showAlert("Erreur", e.message || "Impossible de charger les destinataires");
    } finally {
      setLoadingPreview(false);
    }
  };

  useEffect(() => {
    loadRecipients(includeGuests);
  }, [videoId, includeGuests]);

  // Refresh default body when client name changes
  useEffect(() => {
    if (clientName) setBody(DEFAULT_BODY_FN(clientName));
  }, [clientName]);

  const send = async () => {
    if (!title.trim() || !body.trim()) {
      showAlert("Erreur", "Le titre et le message sont requis.");
      return;
    }
    if (!sendPush && !sendEmail) {
      showAlert("Erreur", "Sélectionnez au moins push ou email.");
      return;
    }
    setSending(true);
    try {
      const r = await api<{
        push: { sent: number; failed: number };
        email: { sent: number; failed: number };
        recipients: { owners: number; guests: number; push_devices: number; emails: number };
      }>(`/admin/videos/${videoId}/notify`, {
        method: "POST",
        body: {
          title: title.trim(),
          message: body.trim(),
          include_guests: includeGuests,
          send_push: sendPush,
          send_email: sendEmail,
        },
      });
      const summary = [
        sendPush ? `📱 ${r.push.sent} notif${r.push.sent > 1 ? "s" : ""} envoyée${r.push.sent > 1 ? "s" : ""}${r.push.failed ? ` (${r.push.failed} échec)` : ""}` : null,
        sendEmail ? `📧 ${r.email.sent} email${r.email.sent > 1 ? "s" : ""} envoyé${r.email.sent > 1 ? "s" : ""}${r.email.failed ? ` (${r.email.failed} échec)` : ""}` : null,
      ]
        .filter(Boolean)
        .join("\n");
      showAlert("✅ Envoyé !", summary || "Aucun destinataire");
      setConfirmStep(false);
    } catch (e: any) {
      showAlert("Erreur d'envoi", e.message || "Échec de l'envoi");
    } finally {
      setSending(false);
    }
  };

  const totalDevices = recipients?.push_devices ?? 0;
  const totalEmails = recipients?.emails ?? 0;
  const totalOwners = recipients?.owners ?? 0;
  const totalGuests = recipients?.guests ?? 0;
  const noRecipients = totalOwners === 0 && totalGuests === 0;

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <Ionicons name="notifications" size={20} color={colors.gold} />
        <Text style={styles.cardTitle}>Notifier les mariés</Text>
      </View>
      <Text style={styles.cardSubtitle}>
        Envoyez une alerte aux mariés quand leur film est en ligne (push mobile + email).
      </Text>

      {/* RECIPIENTS PREVIEW */}
      <View style={styles.recipientsBox}>
        {loadingPreview ? (
          <ActivityIndicator color={colors.gold} />
        ) : noRecipients ? (
          <Text style={styles.warnText}>
            ⚠️ Aucun couple propriétaire trouvé. Le mariage doit être rattaché à un compte utilisateur (via le code de mariage ou l'attribution admin).
          </Text>
        ) : (
          <>
            <View style={styles.statRow}>
              <Ionicons name="heart" size={14} color={colors.gold} />
              <Text style={styles.statTxt}>
                <Text style={styles.statNum}>{totalOwners}</Text> couple propriétaire{totalOwners > 1 ? "s" : ""}
              </Text>
            </View>
            {includeGuests && (
              <View style={styles.statRow}>
                <Ionicons name="people" size={14} color={colors.gold} />
                <Text style={styles.statTxt}>
                  <Text style={styles.statNum}>{totalGuests}</Text> invité{totalGuests > 1 ? "s" : ""} ayant déverrouillé le code
                </Text>
              </View>
            )}
            <View style={styles.statRow}>
              <Ionicons name="phone-portrait" size={14} color={colors.success} />
              <Text style={styles.statTxt}>
                <Text style={styles.statNum}>{totalDevices}</Text> appareil{totalDevices > 1 ? "s" : ""} avec l'app
              </Text>
            </View>
            <View style={styles.statRow}>
              <Ionicons name="mail" size={14} color={colors.success} />
              <Text style={styles.statTxt}>
                <Text style={styles.statNum}>{totalEmails}</Text> email{totalEmails > 1 ? "s" : ""}
              </Text>
            </View>
          </>
        )}
      </View>

      {/* OPTIONS */}
      <View style={styles.switchLine}>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchLabel}>Notifier aussi les invités</Text>
          <Text style={styles.switchHint}>Tous ceux qui ont déjà déverrouillé le code</Text>
        </View>
        <Switch
          value={includeGuests}
          onValueChange={setIncludeGuests}
          trackColor={{ true: colors.gold }}
          testID="notify-include-guests"
        />
      </View>

      <View style={styles.switchLine}>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchLabel}>📱 Notification push (mobile)</Text>
          <Text style={styles.switchHint}>App installée requise</Text>
        </View>
        <Switch value={sendPush} onValueChange={setSendPush} trackColor={{ true: colors.gold }} testID="notify-push" />
      </View>

      <View style={styles.switchLine}>
        <View style={{ flex: 1 }}>
          <Text style={styles.switchLabel}>📧 Email</Text>
          <Text style={styles.switchHint}>Envoyé à tous les destinataires</Text>
        </View>
        <Switch value={sendEmail} onValueChange={setSendEmail} trackColor={{ true: colors.gold }} testID="notify-email" />
      </View>

      {/* MESSAGE */}
      <Text style={styles.fieldLabel}>Titre</Text>
      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder={DEFAULT_TITLE}
        placeholderTextColor={colors.textDisabled}
        maxLength={80}
      />
      <Text style={styles.charCount}>{title.length}/80</Text>

      <Text style={styles.fieldLabel}>Message</Text>
      <TextInput
        style={[styles.input, { minHeight: 80, textAlignVertical: "top" }]}
        value={body}
        onChangeText={setBody}
        placeholder="Message personnalisé"
        placeholderTextColor={colors.textDisabled}
        multiline
        maxLength={240}
      />
      <Text style={styles.charCount}>{body.length}/240</Text>

      <TouchableOpacity
        style={styles.resetBtn}
        onPress={() => {
          setTitle(DEFAULT_TITLE);
          setBody(DEFAULT_BODY_FN(clientName || "Votre mariage"));
        }}
      >
        <Ionicons name="refresh" size={14} color={colors.textSecondary} />
        <Text style={styles.resetBtnTxt}>Réinitialiser le message</Text>
      </TouchableOpacity>

      {/* SEND BUTTON with 2-step confirmation */}
      {!confirmStep ? (
        <TouchableOpacity
          style={[styles.sendBtn, noRecipients && { opacity: 0.4 }]}
          onPress={() => setConfirmStep(true)}
          disabled={noRecipients || sending}
          testID="notify-send-btn"
        >
          <Ionicons name="send" size={16} color="#0A0A0A" />
          <Text style={styles.sendBtnTxt}>Envoyer la notification</Text>
        </TouchableOpacity>
      ) : (
        <View style={styles.confirmBox}>
          <Text style={styles.confirmText}>
            ⚠️ Confirmer l'envoi à{" "}
            <Text style={{ color: colors.gold, fontWeight: "700" }}>
              {totalOwners + (includeGuests ? totalGuests : 0)} personne
              {totalOwners + (includeGuests ? totalGuests : 0) > 1 ? "s" : ""}
            </Text>{" "}
            ?
          </Text>
          <View style={styles.confirmActions}>
            <TouchableOpacity
              style={[styles.confirmBtn, styles.cancelBtn]}
              onPress={() => setConfirmStep(false)}
              disabled={sending}
            >
              <Text style={styles.cancelBtnTxt}>Annuler</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.confirmBtn, styles.confirmYesBtn]}
              onPress={send}
              disabled={sending}
              testID="notify-confirm-btn"
            >
              {sending ? (
                <ActivityIndicator color="#0A0A0A" size="small" />
              ) : (
                <Text style={styles.confirmYesTxt}>Confirmer l'envoi</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: "rgba(212,175,55,0.06)",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.25)",
  },
  headerRow: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  cardTitle: { color: colors.gold, fontSize: 16, fontWeight: "700", letterSpacing: 0.3 },
  cardSubtitle: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.md, lineHeight: 17 },
  recipientsBox: {
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
    gap: 6,
  },
  statRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  statTxt: { color: colors.ivory, fontSize: 13 },
  statNum: { color: colors.gold, fontWeight: "700" },
  warnText: { color: "#FFB74D", fontSize: 13, lineHeight: 19 },
  switchLine: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: radii.sm,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: colors.border,
  },
  switchLabel: { color: colors.ivory, fontSize: 13, fontWeight: "600" },
  switchHint: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  fieldLabel: { color: colors.textSecondary, fontSize: 11, marginTop: 10, marginBottom: 4, letterSpacing: 0.5, textTransform: "uppercase" },
  input: {
    backgroundColor: colors.surface,
    color: colors.ivory,
    borderRadius: radii.sm,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  charCount: { color: colors.textDisabled, fontSize: 10, textAlign: "right", marginTop: 2 },
  resetBtn: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", marginTop: 8 },
  resetBtnTxt: { color: colors.textSecondary, fontSize: 11, textDecorationLine: "underline" },
  sendBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.gold,
    paddingVertical: 14,
    borderRadius: radii.sm,
    marginTop: spacing.md,
  },
  sendBtnTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 14, letterSpacing: 0.4 },
  confirmBox: {
    marginTop: spacing.md,
    padding: 14,
    borderRadius: radii.sm,
    backgroundColor: "rgba(255,183,77,0.1)",
    borderWidth: 1.5,
    borderColor: "#FFB74D",
  },
  confirmText: { color: colors.ivory, fontSize: 14, marginBottom: 12, textAlign: "center" },
  confirmActions: { flexDirection: "row", gap: 8 },
  confirmBtn: { flex: 1, paddingVertical: 12, borderRadius: radii.sm, alignItems: "center" },
  cancelBtn: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  cancelBtnTxt: { color: colors.ivory, fontWeight: "600", fontSize: 13 },
  confirmYesBtn: { backgroundColor: colors.gold },
  confirmYesTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 13 },
});

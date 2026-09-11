import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Alert,
  Platform,
  KeyboardAvoidingView,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { IS_IOS_NATIVE } from "@/src/utils/platform";

type WeddingInfo = {
  client_id: string;
  wedding_name: string;
  message_count: number;
};

/**
 * Public guestbook page — accessed via QR code by wedding guests.
 * WEB ONLY : on iOS native we redirect to a friendly message.
 */
export default function GuestbookPage() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const [info, setInfo] = useState<WeddingInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [media, setMedia] = useState<{ url: string; type: "audio" | "video"; name: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<WeddingInfo>(`/guestbook/${clientId}/info`);
        setInfo(r);
      } catch (e: any) {
        setError(e?.message || "Mariage introuvable");
      } finally {
        setLoading(false);
      }
    })();
  }, [clientId]);

  // On iOS native app, redirect guests to the web
  if (IS_IOS_NATIVE) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.iosNotice}>
          <Ionicons name="globe-outline" size={48} color={colors.gold} />
          <Text style={styles.iosNoticeTitle}>Livre d'or</Text>
          <Text style={styles.iosNoticeText}>
            Cette page est accessible depuis votre navigateur.{"\n"}
            Ouvrez cinemaries.fr/guestbook/{clientId} depuis Safari.
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  const pickMedia = async (type: "audio" | "video") => {
    if (Platform.OS !== "web") {
      Alert.alert("Web uniquement", "Ouvrez cette page depuis un navigateur pour enregistrer.");
      return;
    }
    // Use a native file input — accept alone controls the file type filter.
    // On mobile, accept="audio/*" opens the voice recorder, accept="video/*" opens the camera.
    // NOTE: `capture` attribute values must be "user" or "environment" (spec).
    //       Using invalid values like "microphone" makes browsers fall back to video capture.
    //       For audio, we OMIT capture entirely so the OS picks the right recorder from `accept`.
    const input = document.createElement("input");
    input.type = "file";
    input.accept = type === "audio" ? "audio/*" : "video/*";
    if (type === "video") {
      // Only set capture for video (front camera hint on mobile)
      (input as any).capture = "user";
    }
    input.onchange = async () => {
      const file = (input.files && input.files[0]) as any;
      if (!file) return;
      const maxMb = 25;
      if (file.size > maxMb * 1024 * 1024) {
        Alert.alert("Fichier trop lourd", `Max ${maxMb} Mo. Votre fichier fait ${Math.round(file.size / 1024 / 1024)} Mo.`);
        return;
      }
      setUploading(true);
      try {
        const fd = new FormData();
        fd.append("file", file);
        fd.append("media_type", type);
        // Manual fetch: we can't use api() helper because it JSON-serializes body
        const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || "";
        const resp = await fetch(`${backendUrl}/api/guestbook/${clientId}/upload`, {
          method: "POST",
          body: fd,
        });
        if (!resp.ok) {
          const err = await resp.text();
          throw new Error(err.slice(0, 200) || `HTTP ${resp.status}`);
        }
        const data = await resp.json();
        setMedia({ url: data.url, type, name: file.name });
      } catch (e: any) {
        Alert.alert("Upload échoué", e?.message || "Erreur upload");
      } finally {
        setUploading(false);
      }
    };
    input.click();
  };

  const submit = async () => {
    if (!text.trim() && !media) {
      Alert.alert("Vide ?", "Écrivez un message ou enregistrez un audio/vidéo.");
      return;
    }
    setSubmitting(true);
    try {
      await api(`/guestbook/${clientId}/entries`, {
        method: "POST",
        body: {
          guest_name: name.trim() || null,
          message_text: text.trim() || null,
          media_type: media?.type || null,
          media_url: media?.url || null,
        },
      });
      setSent(true);
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Envoi impossible");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.root}>
        <ActivityIndicator color={colors.gold} style={{ marginTop: 60 }} />
      </SafeAreaView>
    );
  }

  if (error || !info) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Ionicons name="alert-circle" size={40} color={colors.gold} />
          <Text style={styles.errorText}>{error || "Mariage introuvable"}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (sent) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Text style={styles.thankEmoji}>💌</Text>
          <Text style={styles.thankTitle}>Merci !</Text>
          <Text style={styles.thankText}>
            Votre message a été envoyé aux mariés. Ils le découvriront après leur cérémonie 💕
          </Text>
          <TouchableOpacity
            style={styles.newBtn}
            onPress={() => {
              setSent(false);
              setName("");
              setText("");
              setMedia(null);
            }}
            testID="new-message-btn"
          >
            <Text style={styles.newBtnText}>Laisser un autre message</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 80 }} keyboardShouldPersistTaps="handled">
          <View style={styles.header}>
            <Text style={styles.emoji}>💌</Text>
            <Text style={styles.brand}>CINÉMARIÉS</Text>
            <Text style={styles.title}>Livre d'or</Text>
            <Text style={styles.wedding}>Mariage de {info.wedding_name}</Text>
            {info.message_count > 0 ? (
              <Text style={styles.counter}>
                {info.message_count} invité{info.message_count > 1 ? "s ont" : " a"} déjà écrit ✨
              </Text>
            ) : null}
          </View>

          <Text style={styles.label}>Votre prénom (optionnel)</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="Laurine"
            placeholderTextColor={colors.textDisabled}
            maxLength={60}
            testID="guest-name"
          />

          <Text style={styles.label}>Votre mot doux</Text>
          <TextInput
            style={[styles.input, { height: 120, textAlignVertical: "top" }]}
            value={text}
            onChangeText={setText}
            placeholder="Félicitations aux mariés..."
            placeholderTextColor={colors.textDisabled}
            multiline
            maxLength={1000}
            testID="guest-text"
          />
          <Text style={styles.hint}>{text.length}/1000 caractères</Text>

          <Text style={styles.label}>Ou enregistrez un message</Text>
          {media ? (
            <View style={styles.mediaPreview}>
              <Ionicons name={media.type === "video" ? "videocam" : "mic"} size={20} color="#4ADE80" />
              <Text style={styles.mediaText} numberOfLines={1}>
                {media.type === "video" ? "Vidéo" : "Audio"} : {media.name}
              </Text>
              <TouchableOpacity onPress={() => setMedia(null)} testID="remove-media">
                <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.mediaButtons}>
              <TouchableOpacity
                style={styles.mediaBtn}
                onPress={() => pickMedia("audio")}
                disabled={uploading}
                testID="pick-audio"
              >
                <Ionicons name="mic" size={22} color={colors.gold} />
                <Text style={styles.mediaBtnText}>Audio</Text>
                <Text style={styles.mediaBtnHint}>60s max</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.mediaBtn}
                onPress={() => pickMedia("video")}
                disabled={uploading}
                testID="pick-video"
              >
                <Ionicons name="videocam" size={22} color={colors.gold} />
                <Text style={styles.mediaBtnText}>Vidéo</Text>
                <Text style={styles.mediaBtnHint}>30s max</Text>
              </TouchableOpacity>
            </View>
          )}
          {uploading ? (
            <View style={styles.uploadingRow}>
              <ActivityIndicator color={colors.gold} size="small" />
              <Text style={styles.hint}>Upload en cours...</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.submitBtn, (submitting || uploading) && { opacity: 0.5 }]}
            onPress={submit}
            disabled={submitting || uploading}
            testID="submit-entry"
          >
            {submitting ? (
              <ActivityIndicator color="#0A0A0A" />
            ) : (
              <>
                <Ionicons name="heart" size={18} color="#0A0A0A" />
                <Text style={styles.submitText}>Envoyer notre vœu</Text>
              </>
            )}
          </TouchableOpacity>

          <Text style={styles.footer}>
            Vos messages seront révélés aux mariés en surprise après leur cérémonie 💕
          </Text>

          <TouchableOpacity
            style={styles.coupleLink}
            onPress={() => {
              if (Platform.OS === "web") {
                window.location.href = `/guestbook/${clientId}/reveal`;
              }
            }}
            testID="couple-reveal-link"
          >
            <Ionicons name="key-outline" size={14} color={colors.gold} />
            <Text style={styles.coupleLinkText}>
              Je suis les marié(e)s — Découvrir mes messages
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  errorText: { color: colors.ivory, fontSize: 16, marginTop: 12, textAlign: "center" },

  header: { alignItems: "center", marginBottom: spacing.lg, marginTop: spacing.md },
  emoji: { fontSize: 48, marginBottom: 8 },
  brand: { color: colors.gold, fontSize: 12, fontWeight: "800", letterSpacing: 3, marginBottom: 4 },
  title: { color: colors.ivory, fontSize: 28, fontWeight: "800" },
  wedding: { color: colors.gold, fontSize: 15, fontStyle: "italic", marginTop: 4 },
  counter: { color: colors.textSecondary, fontSize: 12, marginTop: 12 },

  label: { color: colors.ivory, fontSize: 13, fontWeight: "700", marginTop: spacing.md, marginBottom: 6 },
  input: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 14,
    color: colors.ivory,
    fontSize: 15,
  },
  hint: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },

  mediaButtons: { flexDirection: "row", gap: spacing.sm, marginTop: 6 },
  mediaBtn: {
    flex: 1,
    alignItems: "center",
    padding: spacing.md,
    backgroundColor: "rgba(212,175,55,0.08)",
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radii.md,
    gap: 4,
  },
  mediaBtnText: { color: colors.gold, fontSize: 14, fontWeight: "700" },
  mediaBtnHint: { color: colors.textSecondary, fontSize: 11 },
  mediaPreview: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    backgroundColor: "rgba(74,222,128,0.10)",
    borderWidth: 1,
    borderColor: "#4ADE80",
    borderRadius: radii.md,
    gap: 8,
    marginTop: 6,
  },
  mediaText: { flex: 1, color: colors.ivory, fontSize: 13 },
  uploadingRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },

  submitBtn: {
    marginTop: spacing.xl,
    backgroundColor: colors.gold,
    paddingVertical: 16,
    borderRadius: radii.md,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    gap: 8,
  },
  submitText: { color: "#0A0A0A", fontWeight: "800", fontSize: 15 },

  footer: {
    color: colors.textSecondary,
    fontSize: 12,
    textAlign: "center",
    marginTop: spacing.xl,
    lineHeight: 18,
  },
  coupleLink: {
    marginTop: spacing.lg,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  coupleLinkText: { color: colors.gold, fontSize: 12, textDecorationLine: "underline" },

  thankEmoji: { fontSize: 72 },
  thankTitle: { color: colors.gold, fontSize: 32, fontWeight: "800", marginTop: 12 },
  thankText: { color: colors.ivory, fontSize: 15, textAlign: "center", marginTop: 12, lineHeight: 22 },
  newBtn: { marginTop: spacing.xl, borderWidth: 1, borderColor: colors.gold, paddingHorizontal: 24, paddingVertical: 12, borderRadius: radii.sm },
  newBtnText: { color: colors.gold, fontWeight: "700" },

  iosNotice: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.xl, gap: spacing.md },
  iosNoticeTitle: { color: colors.gold, fontSize: 22, fontWeight: "800" },
  iosNoticeText: { color: colors.ivory, fontSize: 14, textAlign: "center", lineHeight: 22 },
});

import { useEffect, useState, useRef } from "react";
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
import { BACKEND_URL } from "@/src/api/baseUrl";

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

  const [recording, setRecording] = useState<"audio" | "video" | null>(null);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const mediaRecorderRef = useRef<any>(null);
  const mediaStreamRef = useRef<any>(null);
  const recordTimerRef = useRef<any>(null);
  const videoPreviewRef = useRef<any>(null);

  const stopRecording = () => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.stop();
    }
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t: any) => t.stop());
      mediaStreamRef.current = null;
    }
    if (recordTimerRef.current) {
      clearInterval(recordTimerRef.current);
      recordTimerRef.current = null;
    }
  };

  const startRecording = async (type: "audio" | "video") => {
    if (Platform.OS !== "web" || typeof navigator === "undefined" || !navigator.mediaDevices) {
      Alert.alert("Non supporté", "Votre navigateur ne supporte pas l'enregistrement audio/vidéo.");
      return;
    }
    const maxSeconds = type === "audio" ? 60 : 30;
    try {
      const constraints: any = type === "audio"
        ? { audio: true, video: false }
        : { audio: true, video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } } };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      mediaStreamRef.current = stream;

      // Show video preview while recording
      if (type === "video") {
        setTimeout(() => {
          if (videoPreviewRef.current) {
            videoPreviewRef.current.srcObject = stream;
            videoPreviewRef.current.play().catch(() => {});
          }
        }, 100);
      }

      const chunks: Blob[] = [];
      // Pick best mime type available
      const mimeCandidates = type === "audio"
        ? ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg"]
        : ["video/webm;codecs=vp8,opus", "video/webm", "video/mp4"];
      const mimeType = mimeCandidates.find((m) => (window as any).MediaRecorder?.isTypeSupported?.(m)) || "";

      const recorder = new (window as any).MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recorder.ondataavailable = (e: any) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: mimeType || (type === "audio" ? "audio/webm" : "video/webm") });
        const ext = (mimeType.split("/")[1] || "webm").split(";")[0];
        const filename = `${type}-${Date.now()}.${ext}`;
        const file = new File([blob], filename, { type: blob.type });
        setUploading(true);
        try {
          const fd = new FormData();
          fd.append("file", file);
          fd.append("media_type", type);
          const backendUrl = BACKEND_URL || "";
          const resp = await fetch(`${backendUrl}/api/guestbook/${clientId}/upload`, {
            method: "POST",
            body: fd,
          });
          if (!resp.ok) {
            const err = await resp.text();
            throw new Error(err.slice(0, 200) || `HTTP ${resp.status}`);
          }
          const data = await resp.json();
          setMedia({ url: data.url, type, name: filename });
        } catch (e: any) {
          Alert.alert("Upload échoué", e?.message || "Erreur upload");
        } finally {
          setUploading(false);
          setRecording(null);
          setRecordSeconds(0);
        }
      };

      mediaRecorderRef.current = recorder;
      recorder.start(1000);
      setRecording(type);
      setRecordSeconds(0);
      recordTimerRef.current = setInterval(() => {
        setRecordSeconds((s) => {
          if (s + 1 >= maxSeconds) {
            stopRecording();
            return maxSeconds;
          }
          return s + 1;
        });
      }, 1000);
    } catch (e: any) {
      let msg = "Impossible d'accéder au micro/caméra";
      if (e?.name === "NotAllowedError") msg = "Permission refusée. Autorisez le micro/caméra dans votre navigateur.";
      else if (e?.name === "NotFoundError") msg = "Aucun micro/caméra détecté sur cet appareil.";
      Alert.alert("Enregistrement impossible", msg);
    }
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => stopRecording();
  }, []);

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
                {media.type === "video" ? "Vidéo" : "Audio"} enregistré ✓
              </Text>
              <TouchableOpacity onPress={() => setMedia(null)} testID="remove-media">
                <Ionicons name="close-circle" size={22} color={colors.textSecondary} />
              </TouchableOpacity>
            </View>
          ) : recording ? (
            <View style={styles.recordingBox}>
              {recording === "video" && Platform.OS === "web" && (
                <View style={styles.videoPreviewWrap}>
                  {/* @ts-ignore — web-only video element */}
                  <video ref={videoPreviewRef} style={{ width: "100%", borderRadius: 12, background: "#000" } as any} muted playsInline />
                </View>
              )}
              <View style={styles.recordingRow}>
                <View style={styles.recDot} />
                <Text style={styles.recTime}>
                  {String(Math.floor(recordSeconds / 60)).padStart(2, "0")}:{String(recordSeconds % 60).padStart(2, "0")}
                  {" / "}
                  {recording === "audio" ? "01:00" : "00:30"}
                </Text>
              </View>
              <TouchableOpacity
                style={styles.stopBtn}
                onPress={stopRecording}
                testID="stop-recording"
              >
                <Ionicons name="stop" size={18} color="#0A0A0A" />
                <Text style={styles.stopBtnText}>Arrêter et envoyer</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.mediaButtons}>
              <TouchableOpacity
                style={styles.mediaBtn}
                onPress={() => startRecording("audio")}
                disabled={uploading}
                testID="pick-audio"
              >
                <Ionicons name="mic" size={22} color={colors.gold} />
                <Text style={styles.mediaBtnText}>Audio</Text>
                <Text style={styles.mediaBtnHint}>60s max</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.mediaBtn}
                onPress={() => startRecording("video")}
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

  recordingBox: {
    marginTop: 6,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: "#DC2626",
    backgroundColor: "rgba(220,38,38,0.06)",
    borderRadius: radii.md,
    gap: 12,
  },
  videoPreviewWrap: { width: "100%", aspectRatio: 4 / 3, borderRadius: radii.md, overflow: "hidden" },
  recordingRow: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 10 },
  recDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: "#DC2626" },
  recTime: { color: colors.ivory, fontSize: 18, fontWeight: "700", fontVariant: ["tabular-nums"] },
  stopBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    backgroundColor: colors.gold,
    paddingVertical: 12,
    borderRadius: radii.md,
  },
  stopBtnText: { color: "#0A0A0A", fontSize: 14, fontWeight: "800" },

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

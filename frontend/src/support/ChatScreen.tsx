/**
 * Reusable chat screen used by both /support/[id] (user) and /admin/support/[id] (admin).
 * Polls the ticket every 8s. Displays bubbles (user right, admin left), supports text + photo attachments.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { api } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { showAlert } from "@/src/utils/dialog";
import { colors, spacing, radii } from "@/src/theme";
import { Ticket, Message, STATUS_LABEL, STATUS_COLOR } from "./types";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL || "";

export function ChatScreen({
  ticketId,
  asAdmin,
}: {
  ticketId: string;
  asAdmin: boolean;
}) {
  const router = useRouter();
  const [ticket, setTicket] = useState<Ticket | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  const isMountedRef = useRef(true);

  const load = useCallback(async (silent = false) => {
    try {
      const r = await api<{ ticket: Ticket; messages: Message[] }>(`/support/tickets/${ticketId}`);
      if (!isMountedRef.current) return;
      setTicket(r.ticket);
      setMessages(r.messages || []);
      if (!silent) setLoading(false);
      // Mark as read
      api(`/support/tickets/${ticketId}/mark-read`, { method: "POST" }).catch(() => {});
    } catch (e: any) {
      if (!silent) {
        showAlert("Erreur", e.message || "Impossible de charger le ticket");
        setLoading(false);
      }
    }
  }, [ticketId]);

  useEffect(() => {
    isMountedRef.current = true;
    load(false);
    const interval = setInterval(() => load(true), 8000);
    return () => {
      isMountedRef.current = false;
      clearInterval(interval);
    };
  }, [load]);

  // Scroll to bottom when new messages arrive
  useEffect(() => {
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  }, [messages.length]);

  const pickImage = async (): Promise<{ url: string } | null> => {
    try {
      let asset: { uri: string; name?: string; mimeType?: string; file?: File } | null = null;
      if (Platform.OS === "web") {
        const f = await new Promise<File | null>((resolve) => {
          const input = document.createElement("input");
          input.type = "file";
          input.accept = "image/*";
          input.onchange = () => {
            const file = input.files?.[0] || null;
            resolve(file);
          };
          (input as any).oncancel = () => resolve(null);
          input.click();
        });
        if (!f) return null;
        asset = { uri: URL.createObjectURL(f), name: f.name, mimeType: f.type, file: f };
      } else {
        const r = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ImagePicker.MediaTypeOptions.Images,
          quality: 0.7,
        });
        if (r.canceled || !r.assets?.[0]) return null;
        const a = r.assets[0];
        asset = { uri: a.uri, name: a.fileName || "photo.jpg", mimeType: a.mimeType };
      }
      setUploading(true);
      const token = await storage.secureGet<string>("ws_token", "");
      const fd = new FormData();
      let blob: any;
      if (Platform.OS === "web" && (asset as any).file) {
        blob = (asset as any).file;
      } else {
        const resp = await fetch(asset.uri);
        blob = await resp.blob();
      }
      fd.append("file", blob as any, asset.name || "photo.jpg");
      const res = await fetch(`${BASE}/api/support/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
        body: fd as any,
      });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.detail || `Erreur ${res.status}`);
      }
      const j = await res.json();
      return { url: j.url };
    } catch (e: any) {
      showAlert("Erreur", e.message || "Échec de l'envoi de la photo");
      return null;
    } finally {
      setUploading(false);
    }
  };

  const send = async (attachments: { url: string }[] = []) => {
    const body = text.trim();
    if (!body && attachments.length === 0) return;
    setSending(true);
    try {
      const r = await api<{ message: Message; ticket: Ticket }>(`/support/tickets/${ticketId}/messages`, {
        method: "POST",
        body: { text: body, attachments: attachments.map((a) => ({ url: a.url, kind: "image" })) },
      });
      setMessages((prev) => [...prev, r.message]);
      setTicket(r.ticket);
      setText("");
    } catch (e: any) {
      showAlert("Erreur", e.message || "Envoi échoué");
    } finally {
      setSending(false);
    }
  };

  const sendPhoto = async () => {
    const img = await pickImage();
    if (img) await send([img]);
  };

  const closeTicket = async () => {
    if (!ticket) return;
    const next = ticket.status === "closed" ? "open" : "closed";
    try {
      const path = asAdmin ? `/admin/support/tickets/${ticketId}` : `/support/tickets/${ticketId}`;
      await api(path, { method: "PATCH", body: { status: next } });
      setTicket({ ...ticket, status: next });
    } catch (e: any) {
      showAlert("Erreur", e.message);
    }
  };

  const renderedMessages = useMemo(() => {
    const out: { type: "date" | "msg"; key: string; date?: string; msg?: Message }[] = [];
    let lastDate = "";
    for (const m of messages) {
      const d = new Date(m.created_at).toLocaleDateString("fr-FR");
      if (d !== lastDate) {
        out.push({ type: "date", key: `d-${d}-${m.id}`, date: d });
        lastDate = d;
      }
      out.push({ type: "msg", key: m.id, msg: m });
    }
    return out;
  }, [messages]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }
  if (!ticket) {
    return (
      <View style={styles.loading}>
        <Text style={{ color: colors.ivory }}>Ticket introuvable</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={{ flex: 1 }} keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}>
        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} testID="chat-back">
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
          <View style={{ flex: 1, marginHorizontal: 8 }}>
            <Text style={styles.headerTitle} numberOfLines={1}>{ticket.subject}</Text>
            <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
              <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[ticket.status] }]} />
              <Text style={styles.headerSub}>
                {STATUS_LABEL[ticket.status]}
                {asAdmin && ticket.user_email ? ` · ${ticket.user_name || ticket.user_email}` : ""}
              </Text>
            </View>
          </View>
          <TouchableOpacity onPress={closeTicket} style={styles.headerAction} testID="chat-toggle-close">
            <Ionicons name={ticket.status === "closed" ? "refresh" : "checkmark-done"} size={20} color={colors.gold} />
          </TouchableOpacity>
        </View>

        {/* MESSAGES */}
        <ScrollView ref={scrollRef} style={{ flex: 1 }} contentContainerStyle={styles.messagesContainer}>
          {renderedMessages.length === 0 && (
            <Text style={styles.emptyState}>Envoyez votre premier message à notre équipe.</Text>
          )}
          {renderedMessages.map((item) => {
            if (item.type === "date") {
              return (
                <View key={item.key} style={styles.dateRow}>
                  <View style={styles.dateBubble}>
                    <Text style={styles.dateText}>{item.date}</Text>
                  </View>
                </View>
              );
            }
            const m = item.msg!;
            // "mine" = current viewer's bubble (admin viewing admin msgs OR user viewing own msgs)
            const mine = (asAdmin && m.sender_role === "admin") || (!asAdmin && m.sender_role === "user");
            return (
              <View key={item.key} style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowOther]}>
                <View style={[styles.bubble, mine ? styles.bubbleMine : styles.bubbleOther]}>
                  {!mine && (
                    <Text style={styles.bubbleAuthor}>{m.sender_role === "admin" ? "💬 Support" : m.sender_name}</Text>
                  )}
                  {(m.attachments || []).map((a, i) => (
                    <Image
                      key={i}
                      source={{ uri: a.url }}
                      style={styles.attachImg}
                      contentFit="cover"
                    />
                  ))}
                  {!!m.text && (
                    <Text style={[styles.bubbleText, mine ? styles.bubbleTextMine : styles.bubbleTextOther]}>{m.text}</Text>
                  )}
                  <Text style={[styles.bubbleTime, mine ? { color: "rgba(10,10,10,0.55)" } : { color: colors.textDisabled }]}>
                    {new Date(m.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
                  </Text>
                </View>
              </View>
            );
          })}
          <View style={{ height: 12 }} />
        </ScrollView>

        {/* COMPOSER */}
        {ticket.status === "closed" ? (
          <View style={styles.closedBanner}>
            <Ionicons name="lock-closed" size={16} color={colors.textSecondary} />
            <Text style={styles.closedText}>Ticket clôturé · Envoyer un message le rouvrira automatiquement.</Text>
          </View>
        ) : null}
        <View style={styles.composer}>
          <TouchableOpacity onPress={sendPhoto} disabled={uploading || sending} style={styles.iconBtn} testID="chat-photo-btn">
            {uploading ? <ActivityIndicator color={colors.gold} size="small" /> : <Ionicons name="image" size={22} color={colors.gold} />}
          </TouchableOpacity>
          <TextInput
            style={styles.composerInput}
            value={text}
            onChangeText={setText}
            placeholder="Votre message…"
            placeholderTextColor={colors.textDisabled}
            multiline
            maxLength={4000}
            testID="chat-text-input"
          />
          <TouchableOpacity
            onPress={() => send()}
            disabled={sending || (!text.trim() && true)}
            style={[styles.sendBtn, (!text.trim() || sending) && { opacity: 0.4 }]}
            testID="chat-send-btn"
          >
            {sending ? <ActivityIndicator color="#0A0A0A" size="small" /> : <Ionicons name="send" size={20} color="#0A0A0A" />}
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.bg,
  },
  headerTitle: { color: colors.ivory, fontSize: 16, fontWeight: "700" },
  headerSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  headerAction: { padding: 8 },
  messagesContainer: { padding: spacing.md, paddingBottom: 4 },
  emptyState: { textAlign: "center", color: colors.textSecondary, marginTop: 60, fontStyle: "italic" },
  dateRow: { alignItems: "center", marginVertical: 12 },
  dateBubble: { backgroundColor: colors.surface, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 999 },
  dateText: { color: colors.textSecondary, fontSize: 11 },
  bubbleRow: { flexDirection: "row", marginBottom: 8 },
  rowMine: { justifyContent: "flex-end" },
  rowOther: { justifyContent: "flex-start" },
  bubble: { maxWidth: "82%", paddingHorizontal: 12, paddingVertical: 10, borderRadius: 16 },
  bubbleMine: { backgroundColor: colors.gold, borderBottomRightRadius: 4 },
  bubbleOther: { backgroundColor: colors.surface, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  bubbleAuthor: { fontSize: 11, color: colors.gold, fontWeight: "700", marginBottom: 4 },
  bubbleText: { fontSize: 14, lineHeight: 19 },
  bubbleTextMine: { color: "#0A0A0A" },
  bubbleTextOther: { color: colors.ivory },
  bubbleTime: { fontSize: 10, marginTop: 4, alignSelf: "flex-end" },
  attachImg: { width: 220, height: 160, borderRadius: 8, marginBottom: 6, backgroundColor: "#000" },
  closedBanner: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  closedText: { color: colors.textSecondary, fontSize: 11, flex: 1 },
  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 10,
    paddingVertical: 10,
    gap: 8,
    backgroundColor: colors.bg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  iconBtn: { padding: 10, borderRadius: radii.sm, alignSelf: "flex-end" },
  composerInput: {
    flex: 1,
    backgroundColor: colors.surface,
    color: colors.ivory,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    maxHeight: 120,
    fontSize: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  sendBtn: { backgroundColor: colors.gold, width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
});

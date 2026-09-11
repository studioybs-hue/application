import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  Platform,
  Image as RNImage,
  Linking,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { colors, spacing, radii } from "@/src/theme";

type Entry = {
  id: string;
  guest_name: string;
  message_text: string;
  media_type?: string | null;
  media_url?: string | null;
  status: "published" | "hidden";
  created_at: string;
};

type Wedding = { client_id: string; wedding_name: string; total: number; published: number; hidden: number; last_at?: string };

/** Admin list page — index only when no clientId */
export function AdminGuestbookIndex() {
  const router = useRouter();
  const [items, setItems] = useState<Wedding[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api<{ items: Wedding[] }>("/admin/guestbook");
      setItems(r.items);
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Chargement impossible");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.ivory} /></TouchableOpacity>
        <Text style={styles.headerTitle}>Livre d’or</Text>
        <View style={{ width: 26 }} />
      </View>
      {!items ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
        >
          <Text style={styles.sub}>Messages reçus par mariage</Text>
          {items.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="mail-open-outline" size={40} color={colors.textDisabled} />
              <Text style={styles.emptyText}>Aucun message reçu pour l’instant</Text>
              <Text style={styles.emptyHint}>Générez un QR code depuis la fiche d&apos;un mariage pour lancer un livre d’or.</Text>
            </View>
          ) : null}
          {items.map((w) => (
            <TouchableOpacity
              key={w.client_id}
              style={styles.weddingCard}
              onPress={() => router.push(`/admin/guestbook/${w.client_id}`)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.weddingName}>{w.wedding_name}</Text>
                <Text style={styles.weddingId}>{w.client_id}</Text>
                <View style={styles.weddingStats}>
                  <Text style={styles.stat}>💌 {w.total} total</Text>
                  <Text style={[styles.stat, { color: "#4ADE80" }]}>✓ {w.published} publiés</Text>
                  {w.hidden > 0 ? <Text style={[styles.stat, { color: colors.error }]}>◎ {w.hidden} masqués</Text> : null}
                </View>
              </View>
              <Ionicons name="chevron-forward" size={20} color={colors.gold} />
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/** Detail page — moderate entries of a single wedding */
function AdminGuestbookDetail({ clientId }: { clientId: string }) {
  const router = useRouter();
  const [data, setData] = useState<{ wedding_name: string; items: Entry[] } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [qrLoading, setQrLoading] = useState(false);
  const [qrUrl, setQrUrl] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<any>(`/admin/guestbook/${clientId}`);
      setData(r);
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Chargement impossible");
    } finally {
      setRefreshing(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleStatus = async (id: string) => {
    try {
      await api(`/admin/guestbook/${id}`, { method: "PATCH", body: JSON.stringify({}) });
      await load();
    } catch (e: any) {
      Alert.alert("Erreur", e?.message);
    }
  };

  const deleteEntry = async (id: string) => {
    if (Platform.OS === "web") {
      if (!confirm("Supprimer ce message définitivement ?")) return;
    }
    try {
      await api(`/admin/guestbook/${id}`, { method: "DELETE" });
      await load();
    } catch (e: any) {
      Alert.alert("Erreur", e?.message);
    }
  };

  const loadQr = async () => {
    setQrLoading(true);
    try {
      const backendUrl = process.env.EXPO_PUBLIC_BACKEND_URL || "";
      const token = await storage.secureGet<string>("ws_token", "");
      const resp = await fetch(`${backendUrl}/api/admin/guestbook/${clientId}/qr`, {
        headers: { Authorization: `Bearer ${token || ""}` },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      setQrUrl(url);
    } catch (e: any) {
      Alert.alert("Erreur", "QR code indisponible : " + (e?.message || ""));
    } finally {
      setQrLoading(false);
    }
  };

  const guestbookUrl = `${(typeof window !== "undefined" ? window.location.origin : "https://cinemaries.fr")}/guestbook/${clientId}`;

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}><Ionicons name="chevron-back" size={26} color={colors.ivory} /></TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{data?.wedding_name || clientId}</Text>
        <View style={{ width: 26 }} />
      </View>
      {!data ? (
        <ActivityIndicator color={colors.gold} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
        >
          {/* QR code section */}
          <View style={styles.qrCard}>
            <Text style={styles.qrTitle}>🎯 QR code du livre d’or</Text>
            <Text style={styles.qrHint}>À imprimer sur les cartes de table</Text>
            <Text style={styles.qrUrl} selectable>{guestbookUrl}</Text>
            {qrUrl ? (
              <RNImage source={{ uri: qrUrl }} style={styles.qrImg} resizeMode="contain" />
            ) : null}
            <View style={styles.qrActions}>
              <TouchableOpacity style={styles.qrBtn} onPress={loadQr} disabled={qrLoading}>
                {qrLoading ? <ActivityIndicator color="#0A0A0A" /> : (
                  <>
                    <Ionicons name="qr-code" size={16} color="#0A0A0A" />
                    <Text style={styles.qrBtnText}>{qrUrl ? "Régénérer" : "Générer QR code"}</Text>
                  </>
                )}
              </TouchableOpacity>
              {qrUrl ? (
                <TouchableOpacity
                  style={[styles.qrBtn, { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.gold }]}
                  onPress={() => {
                    if (Platform.OS === "web" && qrUrl) {
                      const a = document.createElement("a");
                      a.href = qrUrl;
                      a.download = `qr-livre-or-${clientId}.png`;
                      a.click();
                    }
                  }}
                >
                  <Ionicons name="download-outline" size={16} color={colors.gold} />
                  <Text style={[styles.qrBtnText, { color: colors.gold }]}>Télécharger</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <TouchableOpacity
              style={{ marginTop: spacing.sm }}
              onPress={() => (Platform.OS === "web" ? window.open(guestbookUrl, "_blank") : Linking.openURL(guestbookUrl))}
            >
              <Text style={{ color: colors.gold, fontSize: 12, textAlign: "center", textDecorationLine: "underline" }}>
                Aperçu de la page invité
              </Text>
            </TouchableOpacity>
          </View>

          {/* Messages list */}
          <Text style={styles.sectionTitle}>{data.items.length} message{data.items.length > 1 ? "s" : ""}</Text>
          {data.items.length === 0 ? (
            <Text style={styles.emptyText}>Aucun message pour l’instant.</Text>
          ) : (
            data.items.map((e) => (
              <View key={e.id} style={[styles.entryCard, e.status === "hidden" && { opacity: 0.5 }]}>
                <View style={styles.entryHeader}>
                  <Text style={styles.entryName}>{e.guest_name || "Invité"}</Text>
                  <Text style={styles.entryDate}>{new Date(e.created_at).toLocaleString("fr-FR")}</Text>
                </View>
                {e.message_text ? <Text style={styles.entryText}>{e.message_text}</Text> : null}
                {e.media_url && e.media_type === "video" ? (
                  Platform.OS === "web" ? (
                    // @ts-ignore
                    <video src={e.media_url} controls style={{ width: "100%", maxHeight: 300, borderRadius: 8, marginTop: 8 }} />
                  ) : (
                    <Text style={styles.hint}>Vidéo — ouvrez sur web pour lire</Text>
                  )
                ) : null}
                {e.media_url && e.media_type === "audio" ? (
                  Platform.OS === "web" ? (
                    // @ts-ignore
                    <audio src={e.media_url} controls style={{ width: "100%", marginTop: 8 }} />
                  ) : (
                    <Text style={styles.hint}>Audio — ouvrez sur web pour écouter</Text>
                  )
                ) : null}
                <View style={styles.entryActions}>
                  <TouchableOpacity onPress={() => toggleStatus(e.id)} style={styles.entryBtn}>
                    <Ionicons name={e.status === "published" ? "eye-off-outline" : "eye-outline"} size={16} color={colors.gold} />
                    <Text style={styles.entryBtnText}>{e.status === "published" ? "Masquer" : "Afficher"}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity onPress={() => deleteEntry(e.id)} style={styles.entryBtn}>
                    <Ionicons name="trash-outline" size={16} color={colors.error} />
                    <Text style={[styles.entryBtnText, { color: colors.error }]}>Supprimer</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

export default function AdminGuestbookRoute() {
  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  if (clientId) return <AdminGuestbookDetail clientId={clientId} />;
  return <AdminGuestbookIndex />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    padding: spacing.md, borderBottomWidth: 1, borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.gold, fontSize: 16, fontWeight: "800", letterSpacing: 1, flex: 1, textAlign: "center", marginHorizontal: spacing.md },
  sub: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.md },
  sectionTitle: { color: colors.ivory, fontSize: 14, fontWeight: "700", marginTop: spacing.lg, marginBottom: spacing.sm },
  empty: { alignItems: "center", padding: spacing.xl, gap: 8 },
  emptyText: { color: colors.textSecondary, fontSize: 14, textAlign: "center" },
  emptyHint: { color: colors.textSecondary, fontSize: 12, textAlign: "center", marginTop: 4 },
  hint: { color: colors.textSecondary, fontSize: 12, marginTop: 6 },

  weddingCard: {
    flexDirection: "row", alignItems: "center",
    padding: spacing.md, borderRadius: radii.md,
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  weddingName: { color: colors.ivory, fontSize: 15, fontWeight: "700" },
  weddingId: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  weddingStats: { flexDirection: "row", gap: 12, marginTop: 6 },
  stat: { color: colors.gold, fontSize: 11, fontWeight: "700" },

  qrCard: {
    padding: spacing.md, borderRadius: radii.md,
    backgroundColor: "rgba(212,175,55,0.05)", borderWidth: 1, borderColor: "rgba(212,175,55,0.25)",
    marginBottom: spacing.lg, alignItems: "center",
  },
  qrTitle: { color: colors.gold, fontSize: 15, fontWeight: "800" },
  qrHint: { color: colors.textSecondary, fontSize: 12, marginTop: 2, marginBottom: spacing.sm },
  qrUrl: { color: colors.ivory, fontSize: 11, marginBottom: spacing.sm, textAlign: "center" },
  qrImg: { width: 220, height: 220, marginBottom: spacing.sm, borderRadius: 8, backgroundColor: "#FFFFF0" },
  qrActions: { flexDirection: "row", gap: spacing.sm },
  qrBtn: { flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: colors.gold, paddingHorizontal: 14, paddingVertical: 10, borderRadius: radii.sm },
  qrBtnText: { color: "#0A0A0A", fontWeight: "700", fontSize: 12 },

  entryCard: { padding: spacing.md, borderRadius: radii.md, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  entryHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 6 },
  entryName: { color: colors.gold, fontSize: 14, fontWeight: "700" },
  entryDate: { color: colors.textSecondary, fontSize: 11 },
  entryText: { color: colors.ivory, fontSize: 14, lineHeight: 20 },
  entryActions: { flexDirection: "row", gap: spacing.md, marginTop: 12, paddingTop: 8, borderTopWidth: 1, borderTopColor: colors.border },
  entryBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  entryBtnText: { color: colors.gold, fontSize: 12, fontWeight: "600" },
});

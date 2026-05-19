import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Platform, Share } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert } from "@/src/utils/dialog";

type StatusResp = {
  status: string;
  couple_name?: string;
  delivery_method?: string;
  upload_url?: string | null;
  upload_token?: string | null;
};

export default function HostSuccess() {
  const router = useRouter();
  const { session_id, request_id } = useLocalSearchParams<{ session_id?: string; request_id?: string }>();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<StatusResp | null>(null);

  useEffect(() => {
    (async () => {
      if (!request_id) { setLoading(false); return; }
      try {
        const r = await api<StatusResp>(`/hosting/requests/${request_id}/status?session_id=${session_id || ""}`);
        setData(r);
      } catch {}
      setLoading(false);
    })();
  }, [request_id, session_id]);

  const paid = data?.status === "paid" || data?.status === "published" || data?.status === "in_progress";
  const hasUploadLink = data?.delivery_method === "upload_link" && !!data?.upload_url;

  const copyUrl = async () => {
    if (!data?.upload_url) return;
    await Clipboard.setStringAsync(data.upload_url);
    showAlert("Copié", "Lien copié dans le presse-papier.");
  };

  const shareUrl = async () => {
    if (!data?.upload_url) return;
    const msg = `Salut ! Voici le lien sécurisé pour déposer les vidéos brutes du mariage de ${data.couple_name} :\n\n${data.upload_url}\n\n(Lien personnel, à ne pas partager publiquement.)`;
    try {
      if (Platform.OS === "web" && (navigator as any).share) {
        await (navigator as any).share({ title: "Lien d'upload CINÉMARIÉS", text: msg });
      } else {
        await Share.share({ message: msg });
      }
    } catch {}
  };

  return (
    <View style={styles.root}>
      <LinearGradient colors={[colors.burgundy, colors.bg]} style={StyleSheet.absoluteFillObject} />
      <SafeAreaView style={{ flex: 1 }}>
        <View style={styles.container}>
          {loading ? (
            <ActivityIndicator color={colors.gold} size="large" />
          ) : (
            <>
              <View style={styles.iconWrap}>
                <Ionicons name="checkmark-circle" size={80} color={colors.gold} />
              </View>
              <Text style={styles.title}>Merci ! Votre demande est enregistrée 💝</Text>

              {paid ? (
                <Text style={styles.sub}>
                  Paiement de <Text style={{ color: colors.gold, fontWeight: "700" }}>90€</Text> bien reçu.{"\n\n"}
                  Notre équipe vous recontacte sous <Text style={{ color: colors.gold }}>24h ouvrées</Text> pour démarrer le montage.
                </Text>
              ) : (
                <Text style={styles.sub}>Si vous avez payé, votre statut sera mis à jour sous quelques secondes.</Text>
              )}

              {hasUploadLink && paid && (
                <View style={styles.uploadCard}>
                  <View style={styles.uploadHeader}>
                    <Ionicons name="cloud-upload" size={22} color={colors.gold} />
                    <Text style={styles.uploadTitle}>Votre lien d'upload sécurisé</Text>
                  </View>
                  <Text style={styles.uploadHint}>
                    Partagez ce lien avec votre vidéaste. Il pourra y déposer les vidéos brutes directement (jusqu'à 50 Go par fichier).
                  </Text>
                  <View style={styles.urlBox}>
                    <Text style={styles.urlTxt} numberOfLines={2} selectable>{data!.upload_url}</Text>
                  </View>
                  <View style={styles.actionsRow}>
                    <TouchableOpacity style={styles.actionBtn} onPress={copyUrl}>
                      <Ionicons name="copy-outline" size={16} color={colors.gold} />
                      <Text style={styles.actionTxt}>Copier</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.actionBtn} onPress={shareUrl}>
                      <Ionicons name="share-outline" size={16} color={colors.gold} />
                      <Text style={styles.actionTxt}>Partager</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.actionBtn, { backgroundColor: colors.gold, borderColor: colors.gold }]}
                      onPress={() => {
                        if (Platform.OS === "web" && data?.upload_url) window.open(data.upload_url, "_blank");
                      }}
                    >
                      <Ionicons name="open" size={16} color="#0A0A0A" />
                      <Text style={[styles.actionTxt, { color: "#0A0A0A" }]}>Ouvrir</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              )}

              <TouchableOpacity style={styles.cta} onPress={() => router.replace("/(tabs)/profile")}>
                <Text style={styles.ctaTxt}>Aller sur mon profil</Text>
                <Ionicons name="arrow-forward" size={18} color="#0A0A0A" />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => router.replace("/(tabs)/home")}>
                <Text style={styles.link}>Retour à l'accueil</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1, padding: spacing.lg, alignItems: "center", justifyContent: "center" },
  iconWrap: { marginBottom: spacing.lg },
  title: { color: colors.ivory, fontSize: 22, fontWeight: "700", textAlign: "center", marginBottom: spacing.md },
  sub: { color: colors.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 22, marginBottom: spacing.lg, paddingHorizontal: spacing.md },
  cta: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.gold, paddingHorizontal: 24, paddingVertical: 14, borderRadius: radii.sm, marginBottom: spacing.md, marginTop: spacing.md },
  ctaTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15 },
  link: { color: colors.textSecondary, textDecorationLine: "underline", fontSize: 13 },
  uploadCard: { width: "100%", backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.gold, borderRadius: radii.md, padding: spacing.md, marginVertical: spacing.md },
  uploadHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 6 },
  uploadTitle: { color: colors.gold, fontSize: 14, fontWeight: "800", letterSpacing: 1 },
  uploadHint: { color: colors.textSecondary, fontSize: 12, lineHeight: 17, marginBottom: 10 },
  urlBox: { backgroundColor: colors.bg, padding: 12, borderRadius: 6, marginBottom: 10, borderWidth: 1, borderColor: colors.border },
  urlTxt: { color: colors.gold, fontSize: 12, fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace" },
  actionsRow: { flexDirection: "row", gap: 8 },
  actionBtn: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 4, flex: 1, paddingVertical: 8, borderWidth: 1, borderColor: colors.gold, borderRadius: 6 },
  actionTxt: { color: colors.gold, fontSize: 12, fontWeight: "700" },
});

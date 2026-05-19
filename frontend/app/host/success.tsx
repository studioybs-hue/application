import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";

export default function HostSuccess() {
  const router = useRouter();
  const { session_id, request_id } = useLocalSearchParams<{ session_id?: string; request_id?: string }>();
  const [loading, setLoading] = useState(true);
  const [paid, setPaid] = useState(false);

  useEffect(() => {
    (async () => {
      if (!request_id) {
        setLoading(false);
        return;
      }
      try {
        const r = await api<{ status: string }>(
          `/hosting/requests/${request_id}/status?session_id=${session_id || ""}`,
        );
        setPaid(r.status === "paid" || r.status === "published" || r.status === "in_progress");
      } catch {}
      setLoading(false);
    })();
  }, [request_id, session_id]);

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
                  Le paiement de <Text style={{ color: colors.gold, fontWeight: "700" }}>90€</Text> a bien été reçu.{"\n\n"}
                  Notre équipe va prendre contact avec vous par email sous <Text style={{ color: colors.gold }}>24h ouvrées</Text> pour démarrer le montage de votre film.{"\n\n"}
                  Une fois votre mariage publié, vous pourrez choisir votre abonnement mensuel pour inviter vos proches.
                </Text>
              ) : (
                <Text style={styles.sub}>
                  Si vous avez payé, votre statut sera mis à jour sous quelques secondes.{"\n"}
                  Sinon, retournez sur la page d'hébergement pour réessayer.
                </Text>
              )}

              <TouchableOpacity
                style={styles.cta}
                onPress={() => router.replace("/(tabs)/profile")}
              >
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
  title: { color: colors.ivory, fontSize: 24, fontWeight: "700", textAlign: "center", marginBottom: spacing.md },
  sub: { color: colors.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 22, marginBottom: spacing.xl, paddingHorizontal: spacing.md },
  cta: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.gold, paddingHorizontal: 24, paddingVertical: 14, borderRadius: radii.sm, marginBottom: spacing.md },
  ctaTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15 },
  link: { color: colors.textSecondary, textDecorationLine: "underline", fontSize: 13 },
});

/**
 * Wedding Claim Screen — autocomplete search to claim a wedding for the current user.
 * Once claimed, the wedding becomes locked to this account and grants auto-unlock
 * (when combined with an active Premium subscription).
 */
import { useEffect, useRef, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { showAlert, showConfirm } from "@/src/utils/dialog";
import { colors, spacing, radii } from "@/src/theme";

type W = { client_id: string; client_name: string; poster_url: string; video_count: number };

export default function ClaimWeddingScreen() {
  const router = useRouter();
  const { user, refresh } = useAuth();
  const [q, setQ] = useState("");
  const [items, setItems] = useState<W[]>([]);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState(false);
  const [alreadyClaimed, setAlreadyClaimed] = useState<string | null>(null);
  const debounceRef = useRef<any>(null);

  const search = async (query: string) => {
    setLoading(true);
    try {
      const url = query.trim() ? `/weddings/claimable?q=${encodeURIComponent(query.trim())}` : "/weddings/claimable";
      const r = await api<{ items: W[]; already_claimed: string | null }>(url, { auth: true });
      setItems(r.items);
      setAlreadyClaimed(r.already_claimed || null);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    search("");
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => search(q), 350);
    return () => debounceRef.current && clearTimeout(debounceRef.current);
  }, [q]);

  const doClaim = async (w: W) => {
    const ok = await showConfirm(
      "Confirmer la revendication",
      `Vous êtes sur le point de revendiquer le mariage de ${w.client_name}.\n\nCette action est IRRÉVERSIBLE depuis votre compte. Seul l'administrateur du studio pourra l'annuler.\n\nVous confirmez être l'un des mariés ?`,
      { confirmText: "Oui, c'est mon mariage", cancelText: "Annuler" }
    );
    if (!ok) return;
    setClaiming(true);
    try {
      await api(`/weddings/${w.client_id}/claim`, { method: "POST", body: {}, auth: true });
      await refresh();
      showAlert(
        "✓ Mariage revendiqué",
        `Félicitations ! ${w.client_name} est maintenant lié à votre compte. Activez votre abonnement Premium pour accéder à toutes vos vidéos et photos.`,
        () => router.replace("/subscription")
      );
    } catch (e: any) {
      showAlert("Impossible de revendiquer", e?.message || "Une erreur est survenue");
    } finally {
      setClaiming(false);
    }
  };

  if (!user) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.center}>
          <Ionicons name="lock-closed" size={48} color={colors.gold} />
          <Text style={styles.errTitle}>Connexion requise</Text>
          <Text style={styles.errSub}>Connectez-vous d&apos;abord pour revendiquer votre mariage.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace("/auth/login")}>
            <Text style={styles.primaryTxt}>Se connecter</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (alreadyClaimed) {
    return (
      <SafeAreaView style={styles.root}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
          <Text style={styles.title}>Mon mariage</Text>
          <View style={{ width: 26 }} />
        </View>
        <View style={styles.center}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={64} color={colors.gold} />
          </View>
          <Text style={styles.errTitle}>Mariage déjà revendiqué</Text>
          <Text style={styles.errSub}>Vous avez déjà revendiqué un mariage.{"\n"}Contactez le studio si c&apos;est une erreur.</Text>
          <TouchableOpacity style={styles.primaryBtn} onPress={() => router.replace("/profile")}>
            <Text style={styles.primaryTxt}>Retour au profil</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <SafeAreaView style={styles.root} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn}>
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
          <Text style={styles.title}>Mon mariage</Text>
          <View style={{ width: 26 }} />
        </View>

        <View style={styles.intro}>
          <View style={styles.introBadge}>
            <Ionicons name="heart" size={20} color={colors.gold} />
          </View>
          <Text style={styles.introTitle}>Êtes-vous l&apos;un des mariés ?</Text>
          <Text style={styles.introSub}>
            Tapez votre nom ou celui de votre conjoint(e) pour retrouver votre mariage et le lier à votre compte.
          </Text>
        </View>

        <View style={styles.searchBox}>
          <Ionicons name="search" size={18} color={colors.textSecondary} />
          <TextInput
            style={styles.searchInput}
            value={q}
            onChangeText={setQ}
            placeholder="Tapez votre nom (ex: Sarahaline)"
            placeholderTextColor={colors.textSecondary}
            autoFocus
            testID="claim-search"
          />
          {loading && <ActivityIndicator size="small" color={colors.gold} />}
          {q.length > 0 && !loading && (
            <TouchableOpacity onPress={() => setQ("")}>
              <Ionicons name="close-circle" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          )}
        </View>

        <FlatList
          data={items}
          keyExtractor={(w) => w.client_id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }}
          renderItem={({ item: w }) => (
            <TouchableOpacity
              style={styles.card}
              activeOpacity={0.85}
              onPress={() => doClaim(w)}
              disabled={claiming}
              testID={`claim-${w.client_id}`}
            >
              {w.poster_url ? (
                <Image source={{ uri: w.poster_url }} style={styles.thumb} contentFit="cover" />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}>
                  <Ionicons name="heart" size={20} color={colors.gold} />
                </View>
              )}
              <View style={{ flex: 1, marginLeft: 12 }}>
                <Text style={styles.cardName} numberOfLines={1}>{w.client_name}</Text>
                <Text style={styles.cardMeta}>{w.video_count} vidéo{w.video_count > 1 ? "s" : ""}</Text>
              </View>
              <View style={styles.actionPill}>
                <Text style={styles.actionTxt}>C&apos;est moi</Text>
                <Ionicons name="arrow-forward" size={14} color="#0A0A0A" />
              </View>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            !loading ? (
              <View style={styles.empty}>
                <Ionicons name="search" size={40} color={colors.textSecondary} />
                <Text style={styles.emptyTxt}>
                  {q.trim() ? "Aucun mariage trouvé avec ce nom" : "Tous les mariages sont déjà revendiqués"}
                </Text>
                <Text style={[styles.emptyTxt, { fontSize: 11, marginTop: 4 }]}>
                  {q.trim() ? "Vérifiez l'orthographe ou contactez le studio" : "Contactez le studio pour plus d'informations"}
                </Text>
              </View>
            ) : null
          }
        />
        {claiming && (
          <View style={styles.overlay}>
            <ActivityIndicator size="large" color={colors.gold} />
            <Text style={styles.overlayTxt}>Revendication en cours...</Text>
          </View>
        )}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    borderBottomWidth: 1, borderBottomColor: "rgba(212,175,55,0.15)",
  },
  iconBtn: { padding: 6 },
  title: { color: colors.ivory, fontSize: 17, fontWeight: "700" },
  intro: { alignItems: "center", padding: spacing.lg, paddingBottom: spacing.md },
  introBadge: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: "rgba(212,175,55,0.12)",
    borderWidth: 1.5, borderColor: colors.gold,
    alignItems: "center", justifyContent: "center", marginBottom: 12,
  },
  introTitle: { color: colors.ivory, fontSize: 18, fontWeight: "700", textAlign: "center" },
  introSub: { color: colors.textSecondary, fontSize: 12, textAlign: "center", marginTop: 6, lineHeight: 18, paddingHorizontal: spacing.md },
  searchBox: {
    flexDirection: "row", alignItems: "center", gap: 10,
    margin: spacing.md, marginTop: 0,
    paddingHorizontal: 14, paddingVertical: 10,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: radii.md, borderWidth: 1, borderColor: "rgba(212,175,55,0.2)",
  },
  searchInput: { flex: 1, color: colors.ivory, fontSize: 14, paddingVertical: 4 },
  card: {
    flexDirection: "row", alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.04)",
    padding: 12, borderRadius: radii.md, marginBottom: 10,
    borderWidth: 1, borderColor: "rgba(212,175,55,0.1)",
  },
  thumb: { width: 56, height: 76, borderRadius: 6, backgroundColor: "rgba(255,255,255,0.05)" },
  thumbEmpty: { alignItems: "center", justifyContent: "center" },
  cardName: { color: colors.ivory, fontSize: 15, fontWeight: "700" },
  cardMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 4 },
  actionPill: {
    flexDirection: "row", alignItems: "center", gap: 4,
    paddingHorizontal: 12, paddingVertical: 8,
    backgroundColor: colors.gold, borderRadius: 999,
  },
  actionTxt: { color: "#0A0A0A", fontSize: 12, fontWeight: "700" },
  empty: { alignItems: "center", paddingVertical: 60 },
  emptyTxt: { color: colors.textSecondary, fontSize: 13, marginTop: 12, textAlign: "center", paddingHorizontal: 32 },
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: spacing.lg },
  errTitle: { color: colors.ivory, fontSize: 18, fontWeight: "700", marginTop: 16, textAlign: "center" },
  errSub: { color: colors.textSecondary, fontSize: 13, textAlign: "center", marginTop: 8, lineHeight: 18 },
  primaryBtn: { backgroundColor: colors.gold, paddingHorizontal: 24, paddingVertical: 12, borderRadius: radii.md, marginTop: 20 },
  primaryTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 14 },
  successIcon: { marginBottom: 8 },
  overlay: {
    ...StyleSheet.absoluteFillObject as any,
    backgroundColor: "rgba(0,0,0,0.85)",
    alignItems: "center", justifyContent: "center",
  },
  overlayTxt: { color: colors.ivory, marginTop: 12, fontSize: 14 },
});

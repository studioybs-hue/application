import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  ActivityIndicator, TextInput, KeyboardAvoidingView, Platform, Modal, Share,
} from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import * as Clipboard from "expo-clipboard";
import { api } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { colors, spacing, radii } from "@/src/theme";
import { useAuth } from "@/src/auth/AuthContext";
import { getDeviceId, getDeviceLabel } from "@/src/utils/deviceId";
import { showAlert } from "@/src/utils/dialog";

type Video = {
  id: string;
  title: string;
  description: string;
  category: string;
  poster_url: string;
  trailer_url: string;
  full_url: string | null;
  duration_minutes: number;
};

type Wedding = {
  client_id: string;
  client_name: string;
  poster_url: string;
  hero_url: string;
  description: string;
  is_top_france: boolean;
  is_featured: boolean;
  video_count: number;
  total_minutes: number;
  unlocked: boolean;
  is_my_wedding?: boolean;
  videos: Video[];
};

type ClientCode = {
  code: string;
  label?: string | null;
  is_active: boolean;
  bound_device_id?: string | null;
  bound_device_label?: string | null;
  bound_at?: string | null;
  created_at?: string | null;
  devices?: { device_id: string; label: string; bound_at?: string | null; last_seen_at?: string | null }[];
  devices_count?: number;
  devices_max?: number;
};

const CODES_KEY = "ws_unlocked_codes"; // JSON-stringified map of client_id -> code

async function getStoredCode(clientId: string): Promise<string | null> {
  const raw = await storage.getItem<string>(CODES_KEY, "{}");
  try {
    const map = JSON.parse(raw || "{}") as Record<string, string>;
    return map[clientId] || null;
  } catch {
    return null;
  }
}
async function saveCode(clientId: string, code: string) {
  const raw = await storage.getItem<string>(CODES_KEY, "{}");
  let map: Record<string, string> = {};
  try { map = JSON.parse(raw || "{}"); } catch {}
  map[clientId] = code;
  await storage.setItem(CODES_KEY, JSON.stringify(map));
}

export default function WeddingScreen() {
  const router = useRouter();
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const { user, refresh: refreshAuth } = useAuth();
  const [wedding, setWedding] = useState<Wedding | null>(null);
  const [loading, setLoading] = useState(true);
  const [codeModal, setCodeModal] = useState(false);
  const [code, setCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Invite (premium client) state
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteCodes, setInviteCodes] = useState<ClientCode[]>([]);
  const [inviteTier, setInviteTier] = useState<string>("basic");
  const [inviteLimit, setInviteLimit] = useState<number | null>(3);
  const [inviteCanCreate, setInviteCanCreate] = useState(true);
  const [inviteLabel, setInviteLabel] = useState("");
  const [inviteGenerating, setInviteGenerating] = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const storedCode = await getStoredCode(clientId);
      const path = storedCode ? `/weddings/${clientId}?code=${encodeURIComponent(storedCode)}` : `/weddings/${clientId}`;
      const d = await api<Wedding>(path);
      setWedding(d);
    } catch (e: any) {
      showAlert("Erreur", e.message);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => { load(); }, [load]);

  const submitCode = async () => {
    setError("");
    const clean = code.trim().toUpperCase();
    if (clean.length < 4) {
      setError("Code invalide");
      return;
    }
    setSubmitting(true);
    try {
      const device_id = await getDeviceId();
      const device_label = getDeviceLabel();
      const r = await api<{ ok: boolean; client_id: string; client_name?: string; video_count?: number; auto_assigned?: boolean; master?: boolean }>(
        "/weddings/unlock",
        { method: "POST", body: { code: clean, device_id, device_label, client_id: clientId } }
      );
      if (!r.master && r.client_id !== clientId) {
        setError(`Ce code est pour « ${r.client_name} », pas pour ce mariage.`);
        setSubmitting(false);
        return;
      }
      await saveCode(clientId, clean);
      setCodeModal(false);
      setCode("");
      // Refresh auth context so the new client_id (if auto-assigned) is reflected.
      if (r.auto_assigned) {
        try {
          await refreshAuth();
        } catch {}
        showAlert(
          "🎉 Bienvenue chez vous !",
          `Votre compte est désormais lié à votre mariage « ${r.client_name} ». Vous pouvez maintenant générer des codes pour vos invités.`
        );
      }
      await load();
    } catch (e: any) {
      setError(e.message || "Code invalide");
    } finally {
      setSubmitting(false);
    }
  };

  const loadInviteCodes = useCallback(async () => {
    setInviteLoading(true);
    try {
      const r = await api<{ codes: ClientCode[]; tier: string; limit: number | null; can_create: boolean }>("/client/codes");
      setInviteCodes(r.codes);
      setInviteTier(r.tier);
      setInviteLimit(r.limit);
      setInviteCanCreate(r.can_create);
    } catch (e: any) {
      showAlert("Erreur", e.message);
    } finally {
      setInviteLoading(false);
    }
  }, []);

  const openInvite = async () => {
    setInviteOpen(true);
    await loadInviteCodes();
  };

  const generateCode = async () => {
    setInviteGenerating(true);
    try {
      const r = await api<{ code: string }>("/client/codes", {
        method: "POST",
        body: { label: inviteLabel.trim() },
      });
      setInviteLabel("");
      await loadInviteCodes();
      showAlert("✓ Code généré", `Votre nouveau code : ${r.code}\n\nIl peut être utilisé sur jusqu'à 3 appareils différents. Copiez-le et partagez-le avec vos invités.`);
    } catch (e: any) {
      showAlert("Erreur", e.message || "Impossible de générer le code");
    } finally {
      setInviteGenerating(false);
    }
  };

  const copyCode = async (c: string) => {
    await Clipboard.setStringAsync(c);
    showAlert("Copié", `Code ${c} copié dans le presse-papier.`);
  };

  const shareInvite = async (c: ClientCode) => {
    try {
      const link = typeof window !== "undefined" ? `${window.location.origin}/wedding/${clientId}` : "";
      const msg = `Je vous invite à découvrir notre mariage sur CINÉMARIÉS 💍\n\nVotre code unique : ${c.code}\n${link ? `\nLien direct : ${link}` : ""}\n\n(Ce code fonctionne sur 3 appareils différents maximum.)`;
      if (Platform.OS === "web" && (navigator as any).share) {
        await (navigator as any).share({ title: "Mon mariage CINÉMARIÉS", text: msg });
      } else {
        await Share.share({ message: msg });
      }
    } catch {}
  };

  const revokeCode = async (c: string) => {
    try {
      await api(`/client/codes/${c}`, { method: "DELETE" });
      await loadInviteCodes();
    } catch (e: any) {
      showAlert("Erreur", e.message);
    }
  };

  if (loading) {
    return <View style={styles.loading}><ActivityIndicator color={colors.gold} size="large" /></View>;
  }
  if (!wedding) return null;

  const teaserUrl = wedding.videos[0]?.trailer_url;
  const teaserHtml = teaserUrl ? `
    <html><head><meta name="viewport" content="width=device-width,initial-scale=1"/>
    <style>html,body{margin:0;padding:0;background:#0A0A0A;height:100%;}
    video{width:100%;height:100%;object-fit:cover;background:#0A0A0A;}</style>
    </head><body>
    <video src="${teaserUrl}" autoplay muted loop playsinline></video>
    </body></html>
  ` : "";

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* TEASER HERO */}
        <View style={styles.hero}>
          {teaserUrl ? (
            Platform.OS === "web" ? (
              // eslint-disable-next-line react-native/no-raw-text
              // @ts-ignore
              <video
                src={teaserUrl}
                autoPlay
                muted
                loop
                playsInline
                style={{ width: "100%", height: "100%", objectFit: "cover", backgroundColor: "#0A0A0A" }}
              />
            ) : (
              <WebView
                source={{ html: teaserHtml }}
                style={StyleSheet.absoluteFillObject}
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
              />
            )
          ) : (
            <Image source={{ uri: wedding.hero_url || wedding.poster_url }} style={StyleSheet.absoluteFillObject} contentFit="cover" />
          )}
          <LinearGradient
            colors={["rgba(10,10,10,0.4)", "rgba(10,10,10,0.2)", "rgba(10,10,10,1)"]}
            locations={[0, 0.5, 1]}
            style={StyleSheet.absoluteFillObject}
            pointerEvents="none"
          />
          <SafeAreaView edges={["top"]} style={styles.heroTop}>
            <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="wedding-back">
              <Ionicons name="chevron-back" size={26} color={colors.ivory} />
            </TouchableOpacity>
            <View style={styles.teaserBadge}>
              <Ionicons name="play" size={12} color={colors.ivory} />
              <Text style={styles.teaserBadgeTxt}>TEASER</Text>
            </View>
          </SafeAreaView>
          <View style={styles.heroBottom} pointerEvents="box-none">
            {wedding.is_top_france && (
              <View style={styles.topBadge}><Text style={styles.topBadgeTxt}>N°1 EN FRANCE</Text></View>
            )}
            <Text style={styles.title}>{wedding.client_name}</Text>
            <View style={styles.meta}>
              <Ionicons name={wedding.unlocked ? "lock-open" : "lock-closed"} size={14} color={wedding.unlocked ? colors.success : colors.gold} />
              <Text style={styles.metaTxt}>
                {wedding.video_count} vidéo{wedding.video_count > 1 ? "s" : ""} · {wedding.total_minutes} min
              </Text>
            </View>
            {wedding.description ? <Text style={styles.desc} numberOfLines={2}>{wedding.description}</Text> : null}
          </View>
        </View>

        {!wedding.unlocked ? (
          <View style={styles.lockedSection} testID="wedding-locked">
            <View style={styles.lockCircle}>
              <Ionicons name="key" size={32} color={colors.gold} />
            </View>
            <Text style={styles.lockedTitle}>Espace privé verrouillé</Text>
            <Text style={styles.lockedSub}>
              Ce mariage est réservé aux invités. Entrez le code unique que les mariés vous ont fourni pour découvrir leurs {wedding.video_count} vidéo{wedding.video_count > 1 ? "s" : ""}.
            </Text>
            <TouchableOpacity style={styles.unlockBtn} onPress={() => setCodeModal(true)} testID="wedding-unlock-btn">
              <Ionicons name="key" size={18} color="#0A0A0A" />
              <Text style={styles.unlockTxt}>Entrer le code</Text>
            </TouchableOpacity>

            <Text style={styles.helpTxt}>
              {user ? "" : "Pas besoin de compte : entrez simplement votre code."}
            </Text>

            <View style={styles.previewSection}>
              <Text style={styles.previewLabel}>APERÇU</Text>
              {wedding.videos.slice(0, 3).map((v) => (
                <View key={v.id} style={styles.previewRow}>
                  <Image source={{ uri: v.poster_url }} style={styles.previewThumb} contentFit="cover" />
                  <View style={{ flex: 1, marginLeft: 12 }}>
                    <Text style={styles.previewTitle}>{v.title}</Text>
                    <Text style={styles.previewMeta}>{v.category} · {v.duration_minutes} min</Text>
                  </View>
                  <Ionicons name="lock-closed" size={18} color={colors.textDisabled} />
                </View>
              ))}
            </View>
          </View>
        ) : (
          <View style={styles.unlockedSection}>
            <View style={styles.unlockedBanner} testID="wedding-unlocked-banner">
              <Ionicons name="checkmark-circle" size={18} color={colors.success} />
              <Text style={styles.unlockedBannerTxt}>Espace privé débloqué — bonnes émotions !</Text>
            </View>

            {wedding.is_my_wedding && (
              <TouchableOpacity
                style={styles.photoGalleryBtn}
                onPress={() => router.push({ pathname: "/photos/[clientId]", params: { clientId: String(clientId) } })}
                testID="wedding-photos-btn"
              >
                <View style={styles.photoGalleryIcon}>
                  <Ionicons name="images" size={26} color={colors.gold} />
                </View>
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.photoGalleryTitle}>Galerie photo</Text>
                  <Text style={styles.photoGallerySub}>
                    Vos photos privées · Diaporama musical · Téléchargement
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color={colors.gold} />
              </TouchableOpacity>
            )}

            {wedding.is_my_wedding && (
              <TouchableOpacity style={styles.inviteBtn} onPress={openInvite} testID="invite-friends-btn">
                <Ionicons name="people" size={20} color="#0A0A0A" />
                <View style={{ flex: 1, marginLeft: 12 }}>
                  <Text style={styles.inviteBtnTitle}>Inviter mes proches</Text>
                  <Text style={styles.inviteBtnSub}>Générez des codes uniques à partager (1 code = jusqu'à 3 appareils)</Text>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#0A0A0A" />
              </TouchableOpacity>
            )}

            <Text style={styles.sectionTitle}>Films de ce mariage</Text>
            {wedding.videos.map((v) => (
              <TouchableOpacity
                key={v.id}
                style={styles.videoCard}
                activeOpacity={0.85}
                onPress={() => router.push(`/video/${v.id}`)}
                testID={`wedding-video-${v.id}`}
              >
                <Image source={{ uri: v.poster_url }} style={styles.videoThumb} contentFit="cover" />
                <View style={styles.playOverlay}>
                  <Ionicons name="play-circle" size={48} color={colors.gold} />
                </View>
                <View style={styles.videoInfo}>
                  <Text style={styles.videoCategory}>{v.category}</Text>
                  <Text style={styles.videoTitle}>{v.title}</Text>
                  <Text style={styles.videoMeta}>{v.duration_minutes} min</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <View style={{ height: 40 }} />
      </ScrollView>

      {/* Code Modal */}
      <Modal visible={codeModal} animationType="slide" transparent onRequestClose={() => setCodeModal(false)}>
        <KeyboardAvoidingView style={styles.modalBg} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={styles.modal}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Code d&apos;accès</Text>
              <TouchableOpacity onPress={() => setCodeModal(false)} testID="close-code-modal">
                <Ionicons name="close" size={26} color={colors.ivory} />
              </TouchableOpacity>
            </View>
            <Text style={styles.modalSub}>
              Saisissez le code que les mariés vous ont remis pour accéder au mariage de <Text style={{ color: colors.gold, fontWeight: "700" }}>{wedding.client_name}</Text>.
            </Text>
            <TextInput
              style={styles.codeInput}
              value={code}
              onChangeText={(t) => setCode(t.toUpperCase().slice(0, 12))}
              placeholder="XXXXXXXX"
              placeholderTextColor={colors.textDisabled}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={12}
              textAlign="center"
              autoFocus
              testID="wedding-code-input"
            />
            {error ? <Text style={styles.error} testID="wedding-code-error">{error}</Text> : null}
            <TouchableOpacity style={styles.submitBtn} onPress={submitCode} disabled={submitting} testID="wedding-code-submit">
              {submitting ? <ActivityIndicator color="#0A0A0A" /> : <Text style={styles.submitTxt}>Débloquer le mariage</Text>}
            </TouchableOpacity>
            <Text style={styles.help}>Pas de code ? Demandez aux mariés ou à votre vidéaste.</Text>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      {/* Invite Friends Modal (premium clients only) */}
      <Modal visible={inviteOpen} animationType="slide" transparent onRequestClose={() => setInviteOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBg} behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <View style={[styles.modal, { maxHeight: "92%" }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Inviter mes proches</Text>
              <TouchableOpacity onPress={() => setInviteOpen(false)}>
                <Ionicons name="close" size={26} color={colors.ivory} />
              </TouchableOpacity>
            </View>

            <Text style={styles.modalSub}>
              Générez des codes uniques pour vos invités. <Text style={{ color: colors.gold, fontWeight: "700" }}>1 code = jusqu'à 3 appareils</Text> (les 3 premiers à l'utiliser sont mémorisés).
            </Text>

            {/* Plan badge */}
            <View style={styles.planBadge}>
              <Ionicons name={inviteTier === "unlimited" ? "infinite" : "star"} size={14} color={colors.gold} />
              <Text style={styles.planBadgeTxt}>
                {inviteTier === "unlimited"
                  ? "Premium Illimité — codes illimités"
                  : `Premium — ${inviteCodes.filter(c => c.is_active).length}/${inviteLimit ?? 3} codes actifs`}
              </Text>
            </View>

            {/* New code form */}
            {inviteCanCreate ? (
              <View style={{ marginTop: spacing.md }}>
                <Text style={styles.modalLabel}>Pour qui ? (optionnel)</Text>
                <TextInput
                  style={styles.modalInput}
                  value={inviteLabel}
                  onChangeText={setInviteLabel}
                  placeholder="Ex : Tatie Jeanne"
                  placeholderTextColor={colors.textDisabled}
                  maxLength={60}
                />
                <TouchableOpacity style={styles.submitBtn} onPress={generateCode} disabled={inviteGenerating} testID="generate-invite-code">
                  {inviteGenerating ? <ActivityIndicator color="#0A0A0A" /> : (
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                      <Ionicons name="add-circle" size={18} color="#0A0A0A" />
                      <Text style={styles.submitTxt}>Générer un nouveau code</Text>
                    </View>
                  )}
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.upsellCard}>
                <Ionicons name="infinite" size={24} color={colors.gold} />
                <Text style={styles.upsellTitle}>Limite atteinte</Text>
                <Text style={styles.upsellSub}>Passez à l'offre Illimité pour 2,30€/mois et créez autant de codes que vous voulez.</Text>
                <TouchableOpacity style={styles.upsellBtn} onPress={() => { setInviteOpen(false); router.push("/subscription?tier=unlimited"); }}>
                  <Text style={styles.upsellBtnTxt}>Passer à l'Illimité — 2,30€/mois</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* List */}
            <Text style={[styles.modalLabel, { marginTop: spacing.lg }]}>Mes codes</Text>
            <ScrollView style={{ maxHeight: 260 }}>
              {inviteLoading ? (
                <ActivityIndicator color={colors.gold} style={{ marginTop: 20 }} />
              ) : inviteCodes.length === 0 ? (
                <Text style={styles.emptyTxt}>Aucun code généré pour l'instant.</Text>
              ) : (
                inviteCodes.map((c) => {
                  const used = c.devices_count ?? (c.bound_device_id ? 1 : 0);
                  const max = c.devices_max ?? 3;
                  return (
                  <View key={c.code} style={[styles.codeRow, !c.is_active && { opacity: 0.5 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.codeRowCode}>{c.code}</Text>
                      <Text style={styles.codeRowMeta}>
                        {c.label ? `${c.label} · ` : ""}
                        {used === 0
                          ? "⌛ Non activé"
                          : `📱 ${used}/${max} appareil${used > 1 ? "s" : ""}${used >= max ? " (complet)" : ""}`}
                      </Text>
                      {(c.devices && c.devices.length > 0) ? (
                        <View style={{ marginTop: 4 }}>
                          {c.devices.map((d, idx) => (
                            <Text key={d.device_id || idx} style={styles.deviceLine} numberOfLines={1}>• {d.label || "Appareil"}</Text>
                          ))}
                        </View>
                      ) : null}
                    </View>
                    <TouchableOpacity onPress={() => copyCode(c.code)} style={styles.smallBtn}>
                      <Ionicons name="copy-outline" size={16} color={colors.gold} />
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => shareInvite(c)} style={styles.smallBtn}>
                      <Ionicons name="share-outline" size={16} color={colors.gold} />
                    </TouchableOpacity>
                    {c.is_active && (
                      <TouchableOpacity onPress={() => revokeCode(c.code)} style={styles.smallBtn}>
                        <Ionicons name="trash-outline" size={16} color={colors.error} />
                      </TouchableOpacity>
                    )}
                  </View>
                  );
                })
              )}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  hero: { width: "100%", height: 380, backgroundColor: "#000", position: "relative", justifyContent: "flex-end" },
  heroTop: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", justifyContent: "space-between", padding: spacing.sm },
  iconBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(0,0,0,0.6)", alignItems: "center", justifyContent: "center" },
  teaserBadge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 4, backgroundColor: "rgba(212,175,55,0.85)" },
  teaserBadgeTxt: { color: "#0A0A0A", fontSize: 11, fontWeight: "700", letterSpacing: 1.5 },
  heroBottom: { padding: spacing.md, paddingBottom: spacing.lg },
  topBadge: { alignSelf: "flex-start", backgroundColor: colors.wine, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4, marginBottom: spacing.sm },
  topBadgeTxt: { color: colors.ivory, fontWeight: "700", fontSize: 11, letterSpacing: 1.5 },
  title: { color: colors.ivory, fontSize: 30, fontWeight: "700", textShadowColor: "rgba(0,0,0,0.7)", textShadowOffset: { width: 0, height: 2 }, textShadowRadius: 6 },
  meta: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  metaTxt: { color: colors.textSecondary, fontSize: 13 },
  desc: { color: colors.textSecondary, fontSize: 14, marginTop: 8, lineHeight: 20 },
  lockedSection: { padding: spacing.md, alignItems: "center" },
  lockCircle: { width: 78, height: 78, borderRadius: 39, borderWidth: 1.5, borderColor: colors.gold, backgroundColor: "rgba(212,175,55,0.08)", alignItems: "center", justifyContent: "center", marginTop: spacing.md },
  lockedTitle: { color: colors.ivory, fontSize: 22, fontWeight: "700", marginTop: spacing.md, textAlign: "center" },
  lockedSub: { color: colors.textSecondary, fontSize: 14, textAlign: "center", marginTop: 8, lineHeight: 20, marginBottom: spacing.lg },
  unlockBtn: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.gold, paddingHorizontal: 28, paddingVertical: 14, borderRadius: radii.sm },
  unlockTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15 },
  helpTxt: { color: colors.textDisabled, fontSize: 11, marginTop: 8, fontStyle: "italic" },
  previewSection: { width: "100%", marginTop: spacing.xl },
  previewLabel: { color: colors.textSecondary, fontSize: 11, letterSpacing: 2, marginBottom: spacing.sm },
  previewRow: { flexDirection: "row", alignItems: "center", backgroundColor: colors.surface, padding: 10, borderRadius: radii.sm, marginBottom: 8 },
  previewThumb: { width: 60, height: 60, borderRadius: 6 },
  previewTitle: { color: colors.ivory, fontSize: 14, fontWeight: "600" },
  previewMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  unlockedSection: { padding: spacing.md },
  unlockedBanner: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(46,125,50,0.15)", borderWidth: 1, borderColor: colors.success, padding: spacing.md, borderRadius: radii.sm, marginBottom: spacing.lg },
  unlockedBannerTxt: { color: colors.ivory, fontSize: 13, fontWeight: "600" },
  sectionTitle: { color: colors.ivory, fontSize: 20, fontWeight: "700", marginBottom: spacing.md },
  videoCard: { backgroundColor: colors.surface, borderRadius: radii.md, overflow: "hidden", marginBottom: spacing.md },
  videoThumb: { width: "100%", aspectRatio: 16 / 9, backgroundColor: colors.surfaceElevated },
  playOverlay: { position: "absolute", top: 0, left: 0, right: 0, height: undefined, aspectRatio: 16 / 9, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0,0,0,0.25)" },
  videoInfo: { padding: spacing.md },
  videoCategory: { color: colors.gold, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "700" },
  videoTitle: { color: colors.ivory, fontSize: 17, fontWeight: "700", marginTop: 4 },
  videoMeta: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  modalBg: { flex: 1, backgroundColor: "rgba(0,0,0,0.7)", justifyContent: "flex-end" },
  modal: { backgroundColor: colors.surfaceElevated, padding: spacing.lg, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: spacing.xl, borderTopWidth: 1, borderColor: colors.gold },
  modalHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: spacing.sm },
  modalTitle: { color: colors.ivory, fontSize: 22, fontWeight: "700" },
  modalSub: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.lg, lineHeight: 18 },
  codeInput: { backgroundColor: colors.bg, color: colors.ivory, fontSize: 28, letterSpacing: 8, fontWeight: "700", paddingVertical: 18, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border },
  error: { color: colors.error, marginTop: spacing.sm, fontSize: 13, textAlign: "center" },
  submitBtn: { backgroundColor: colors.gold, paddingVertical: 16, borderRadius: radii.sm, alignItems: "center", marginTop: spacing.md },
  submitTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 15, letterSpacing: 0.5 },
  help: { color: colors.textDisabled, fontSize: 11, textAlign: "center", marginTop: spacing.md, fontStyle: "italic" },
  inviteBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.gold,
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.lg,
  },
  inviteBtnTitle: { color: "#0A0A0A", fontWeight: "700", fontSize: 15 },
  inviteBtnSub: { color: "rgba(0,0,0,0.7)", fontSize: 11, marginTop: 2 },
  photoGalleryBtn: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: colors.surfaceElevated,
    padding: spacing.md,
    borderRadius: radii.md,
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoGalleryIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: "rgba(212,175,55,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  photoGalleryTitle: { color: colors.ivory, fontWeight: "700", fontSize: 15 },
  photoGallerySub: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  premiumBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: colors.gold,
    paddingHorizontal: 8, paddingVertical: 4,
    borderRadius: 999,
  },
  premiumBadgeTxt: { color: "#000", fontSize: 10, fontWeight: "700" },
  modalLabel: { color: colors.textSecondary, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
  modalInput: { backgroundColor: colors.bg, color: colors.ivory, padding: 14, borderRadius: 8, fontSize: 14, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  planBadge: { flexDirection: "row", alignItems: "center", gap: 6, alignSelf: "flex-start", backgroundColor: "rgba(212,175,55,0.12)", borderWidth: 1, borderColor: colors.gold, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6 },
  planBadgeTxt: { color: colors.gold, fontSize: 12, fontWeight: "600" },
  emptyTxt: { color: colors.textSecondary, fontStyle: "italic", textAlign: "center", paddingVertical: spacing.md },
  codeRow: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.bg, padding: 12, borderRadius: 8, marginBottom: 8, borderWidth: 1, borderColor: colors.border },
  codeRowCode: { color: colors.gold, fontSize: 17, fontWeight: "800", letterSpacing: 2 },
  codeRowMeta: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  smallBtn: { width: 32, height: 32, borderRadius: 6, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  deviceLine: { color: colors.textSecondary, fontSize: 10, marginTop: 1, opacity: 0.8 },
  upsellCard: { marginTop: spacing.md, padding: spacing.md, backgroundColor: "rgba(212,175,55,0.08)", borderWidth: 1, borderColor: colors.gold, borderRadius: radii.md, alignItems: "center" },
  upsellTitle: { color: colors.ivory, fontWeight: "700", fontSize: 16, marginTop: 8 },
  upsellSub: { color: colors.textSecondary, fontSize: 13, textAlign: "center", marginTop: 6, marginBottom: spacing.md, lineHeight: 18 },
  upsellBtn: { backgroundColor: colors.gold, paddingHorizontal: 18, paddingVertical: 12, borderRadius: 8 },
  upsellBtnTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 14 },
});

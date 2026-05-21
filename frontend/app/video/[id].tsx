import { useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
  Share,
} from "react-native";
import { Image } from "expo-image";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useVideoPlayer, VideoView } from "expo-video";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { useAuth } from "@/src/auth/AuthContext";
import { useCast } from "@/src/cast";
import { showAlert } from "@/src/utils/dialog";

type Video = {
  id: string;
  title: string;
  description: string;
  category: string;
  poster_url: string;
  hero_url?: string;
  trailer_url: string;
  full_url: string | null;
  duration_minutes: number;
  is_top_france?: boolean;
};

export default function VideoScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();
  const [video, setVideo] = useState<Video | null>(null);
  const [loading, setLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const castApi = useCast();

  useEffect(() => {
    (async () => {
      try {
        const v = await api<Video>(`/videos/${id}`);
        setVideo(v);
      } catch (e: any) {
        showAlert("Erreur", e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id]);

  // --- HOOKS BLOCK (must be called BEFORE any early return) ---
  const isUnlocked = !!video?.full_url;
  const playableUrl = (isUnlocked ? video?.full_url : null) || video?.trailer_url || video?.full_url || "";

  // Native video player (expo-video) for Android/iOS - supports H.264, HEVC, .m4v, .mp4, .mov etc
  // Force contentType "progressive" so ExoPlayer treats .m4v / .mov / .mp4 the same way (MP4 container).
  const videoSource = playing && Platform.OS !== "web" && playableUrl
    ? { uri: playableUrl, contentType: "progressive" as const, useCaching: false }
    : null;
  const player = useVideoPlayer(videoSource, (p) => {
    p.loop = false;
    if (playing) p.play();
  });

  // Surface playback errors to the user
  useEffect(() => {
    if (!player) return;
    const sub = player.addListener?.("statusChange", (event: any) => {
      if (event?.status === "error" || event?.error) {
        const msg = event?.error?.message || event?.error || "Erreur de lecture inconnue";
        showAlert("Erreur de lecture", `Impossible de lire cette vidéo.\n\n${msg}\n\nVérifiez votre connexion ou contactez l'administrateur.`);
        setPlaying(false);
      }
    });
    return () => { try { sub?.remove?.(); } catch {} };
  }, [player]);
  // --- END HOOKS BLOCK ---

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.gold} />
      </View>
    );
  }
  if (!video) return null;

  const onCastPress = async () => {
    if (!castApi.available) {
      // Module not available
      if (Platform.OS === "web") {
        showAlert(
          "Chromecast indisponible",
          "Votre navigateur ne supporte pas Google Cast.\n\n→ Ouvrez CINÉMARIÉS sur Chrome ou Edge (desktop) et assurez-vous d'être sur le même Wi-Fi que votre Chromecast / TV."
        );
      } else {
        showAlert(
          "Chromecast indisponible",
          "Le module Chromecast n'est pas chargé. Si vous utilisez Expo Go, installez plutôt l'APK officielle (EAS Build)."
        );
      }
      return;
    }
    if (castApi.connected) {
      await castApi.stop();
      showAlert("Diffusion arrêtée", "Lecture revenue sur ce navigateur.");
      return;
    }
    const result = await castApi.cast(playableUrl, video.title, video.poster_url);
    if (!result.ok) {
      showAlert(
        "Problème de diffusion",
        result.error || "Aucun appareil Chromecast sélectionné ou la diffusion a échoué.\n\n💡 Conseil : assurez-vous que le fichier vidéo est au format MP4 (H.264 + AAC) qui est universellement compatible Chromecast."
      );
    }
  };

  const castIconColor = castApi.connected ? colors.gold : castApi.available || Platform.OS !== "web" ? colors.ivory : colors.textDisabled;

  // --- "Ma liste" — navigate to library (videos auto-added on unlock) ---
  const onAddToList = () => {
    if (!user) {
      router.push("/auth/login");
      return;
    }
    router.push("/(tabs)/library");
  };

  // --- "Partager" — native share sheet ---
  const onShare = async () => {
    const shareUrl = `${process.env.EXPO_PUBLIC_BACKEND_URL || "https://cinemaries.fr"}/wedding/${video.client_id || video.id}`;
    const shareMessage = `Découvrez le film de mariage "${video.title}" sur CINÉMARIÉS 🎬\n\n${shareUrl}`;
    try {
      if (Platform.OS === "web") {
        // Web: try Web Share API, fallback to clipboard
        if (typeof navigator !== "undefined" && (navigator as any).share) {
          await (navigator as any).share({
            title: `CINÉMARIÉS — ${video.title}`,
            text: shareMessage,
            url: shareUrl,
          });
        } else if (typeof navigator !== "undefined" && navigator.clipboard) {
          await navigator.clipboard.writeText(shareUrl);
          showAlert("Lien copié", "Le lien a été copié dans votre presse-papiers. Vous pouvez maintenant le coller où vous voulez !");
        } else {
          showAlert("Partage", shareMessage);
        }
      } else {
        // Native: use RN Share API
        await Share.share(
          {
            title: `CINÉMARIÉS — ${video.title}`,
            message: shareMessage,
            url: shareUrl, // iOS uses url
          },
          {
            dialogTitle: "Partager ce film de mariage",
            subject: `CINÉMARIÉS — ${video.title}`,
          }
        );
      }
    } catch (e: any) {
      if (e?.message && !String(e.message).toLowerCase().includes("cancel")) {
        showAlert("Partage", e.message);
      }
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.headerWrap} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="video-back">
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
          <TouchableOpacity onPress={onCastPress} style={styles.iconBtn} testID="video-cast-btn">
            <Ionicons
              name={castApi.connected ? "tv" : "tv-outline"}
              size={22}
              color={castIconColor}
            />
          </TouchableOpacity>
        </View>
      </SafeAreaView>

      <View style={styles.playerWrap}>
        {playing ? (
          Platform.OS === "web" ? (
            <View style={styles.player}>
              {/* eslint-disable-next-line react-native/no-raw-text */}
              <video
                // @ts-ignore
                src={playableUrl}
                autoPlay
                controls
                playsInline
                style={{ width: "100%", height: "100%", backgroundColor: "#000" }}
              />
            </View>
          ) : (
            <VideoView
              player={player}
              style={styles.player}
              contentFit="contain"
              allowsFullscreen
              allowsPictureInPicture
              nativeControls
            />
          )
        ) : (
          <TouchableOpacity
            style={styles.posterWrap}
            activeOpacity={0.9}
            onPress={() => setPlaying(true)}
            testID="video-play-btn"
          >
            <Image source={{ uri: video.hero_url || video.poster_url }} style={styles.posterImg} contentFit="cover" />
            <LinearGradient
              colors={["rgba(0,0,0,0.2)", "rgba(0,0,0,0.7)"]}
              style={StyleSheet.absoluteFillObject}
            />
            <View style={styles.playCenter}>
              <View style={styles.playCircle}>
                <Ionicons name="play" size={36} color="#0A0A0A" />
              </View>
              {!isUnlocked && (
                <View style={styles.trailerBadge}>
                  <Ionicons name="film-outline" size={12} color={colors.ivory} />
                  <Text style={styles.trailerTxt}>Bande-annonce</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        )}
      </View>

      <ScrollView contentContainerStyle={styles.info}>
        <View style={styles.titleRow}>
          {video.is_top_france && (
            <View style={styles.topBadge}>
              <Text style={styles.topBadgeTxt}>N°1 EN FRANCE</Text>
            </View>
          )}
        </View>
        <Text style={styles.title}>{video.title}</Text>
        <View style={styles.meta}>
          <Text style={styles.metaTxt}>{video.category}</Text>
          <Text style={styles.metaDot}>·</Text>
          <Text style={styles.metaTxt}>{video.duration_minutes} min</Text>
        </View>

        {!isUnlocked && (
          <View style={styles.lockCard} testID="video-locked-banner">
            <Ionicons name="lock-closed" size={20} color={colors.gold} />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.lockTitle}>Vidéo privée</Text>
              <Text style={styles.lockSub}>
                Entrez votre code unique pour accéder à la version complète.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.unlockBtn}
              onPress={() =>
                user ? router.push("/unlock") : router.push("/auth/login")
              }
              testID="video-unlock-btn"
            >
              <Text style={styles.unlockTxt}>Code</Text>
            </TouchableOpacity>
          </View>
        )}

        <Text style={styles.desc}>{video.description}</Text>

        <View style={styles.actions}>
          <ActionBtn icon="add" label="Ma liste" onPress={onAddToList} testID="video-action-list" />
          <ActionBtn icon="share-social-outline" label="Partager" onPress={onShare} testID="video-action-share" />
          <ActionBtn
            icon={castApi.connected ? "tv" : "tv-outline"}
            label={castApi.connected ? (castApi.deviceName || "Cast") : "Chromecast"}
            onPress={onCastPress}
            highlighted={castApi.connected}
            testID="video-action-cast"
          />
        </View>
      </ScrollView>
    </View>
  );
}

function ActionBtn({
  icon,
  label,
  onPress,
  highlighted,
  testID,
}: {
  icon: any;
  label: string;
  onPress?: () => void;
  highlighted?: boolean;
  testID?: string;
}) {
  return (
    <TouchableOpacity style={styles.action} onPress={onPress} testID={testID}>
      <Ionicons name={icon} size={22} color={highlighted ? colors.gold : colors.ivory} />
      <Text style={[styles.actionTxt, highlighted && { color: colors.gold }]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  headerWrap: { position: "absolute", top: 0, left: 0, right: 0, zIndex: 10 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xs,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.55)",
    alignItems: "center",
    justifyContent: "center",
  },
  playerWrap: { width: "100%", aspectRatio: 16 / 9, backgroundColor: "#000" },
  posterWrap: { width: "100%", height: "100%" },
  posterImg: { width: "100%", height: "100%" },
  playCenter: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
  playCircle: {
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },
  trailerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 12,
    backgroundColor: "rgba(0,0,0,0.7)",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  trailerTxt: { color: colors.ivory, fontSize: 11, fontWeight: "600", letterSpacing: 1 },
  player: { width: "100%", height: "100%" },
  info: { padding: spacing.md, paddingBottom: spacing.xl },
  titleRow: { flexDirection: "row", marginTop: spacing.sm },
  topBadge: {
    backgroundColor: colors.wine,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 4,
    marginBottom: spacing.sm,
  },
  topBadgeTxt: { color: colors.ivory, fontWeight: "700", fontSize: 11, letterSpacing: 1.5 },
  title: { color: colors.ivory, fontSize: 26, fontWeight: "700" },
  meta: { flexDirection: "row", alignItems: "center", marginTop: 6, gap: 8 },
  metaTxt: { color: colors.textSecondary, fontSize: 13 },
  metaDot: { color: colors.textDisabled },
  lockCard: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  lockTitle: { color: colors.ivory, fontWeight: "700", fontSize: 14 },
  lockSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  unlockBtn: { backgroundColor: colors.gold, paddingHorizontal: 14, paddingVertical: 8, borderRadius: radii.sm },
  unlockTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 13 },
  desc: { color: colors.textSecondary, fontSize: 14, marginTop: spacing.lg, lineHeight: 21 },
  actions: { flexDirection: "row", justifyContent: "space-around", marginTop: spacing.xl },
  action: { alignItems: "center", gap: 6 },
  actionTxt: { color: colors.ivory, fontSize: 11, fontWeight: "600" },
});

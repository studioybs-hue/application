/**
 * CINÉMARIÉS — Diaporama plein écran avec 4 modèles + Chromecast
 *
 * Modèles disponibles :
 *  1. Classic    — fade simple entre photos
 *  2. Ken Burns  — zoom + pan lent (style cinéma)
 *  3. Stories    — barre de progression haut, plein écran portrait
 *  4. Mosaïque   — 4 photos en grille rotative
 *
 * Chromecast : sur appui du bouton Cast, chaque photo est envoyée
 * tour à tour à la TV via la lib useCast. La musique reste sur le téléphone.
 */
import { useEffect, useState, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Dimensions, StatusBar, Animated, ScrollView, Platform,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Audio } from "expo-av";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert } from "@/src/utils/dialog";
import { useCast } from "@/src/cast";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");
const STORAGE_KEY = "cinemaries:slideshow_mode";

type PhotoOut = {
  id: string;
  filename: string;
  thumb_url: string;
  full_url: string;
  order: number;
};

type PhotosInfo = {
  music_url: string | null;
  photos_count: number;
};

type SlideMode = "classic" | "kenburns" | "stories" | "mosaic";

const SPEED_OPTIONS = [
  { label: "3s", value: 3000 },
  { label: "5s", value: 5000 },
  { label: "10s", value: 10000 },
];

const MODES: { id: SlideMode; label: string; icon: any }[] = [
  { id: "classic", label: "Classic", icon: "image-outline" },
  { id: "kenburns", label: "Ciné", icon: "film-outline" },
  { id: "stories", label: "Stories", icon: "phone-portrait-outline" },
  { id: "mosaic", label: "Mosaïque", icon: "grid-outline" },
];

export default function SlideshowScreen() {
  const router = useRouter();
  const { clientId, startId } = useLocalSearchParams<{ clientId: string; startId?: string }>();

  const [photos, setPhotos] = useState<PhotoOut[]>([]);
  const [info, setInfo] = useState<PhotosInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentIdx, setCurrentIdx] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(5000);
  const [musicEnabled, setMusicEnabled] = useState(true);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [mode, setMode] = useState<SlideMode>("kenburns");
  const [casting, setCasting] = useState(false);
  const castApi = useCast();

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const kenBurnsAnim = useRef(new Animated.Value(0)).current;
  const storyProgressAnim = useRef(new Animated.Value(0)).current;
  const soundRef = useRef<Audio.Sound | null>(null);
  const timerRef = useRef<any>(null);
  const controlsTimerRef = useRef<any>(null);

  // ===== Persist mode =====
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (v && ["classic", "kenburns", "stories", "mosaic"].includes(v)) {
        setMode(v as SlideMode);
      }
    });
  }, []);
  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {});
  }, [mode]);

  // ===== Load data =====
  useEffect(() => {
    (async () => {
      try {
        const [pData, iData] = await Promise.all([
          api<PhotoOut[]>(`/weddings/${clientId}/photos?page=1&per_page=100`),
          api<PhotosInfo>(`/weddings/${clientId}/photos/info`),
        ]);
        setPhotos(pData);
        setInfo(iData);
        if (startId) {
          const idx = pData.findIndex((p) => p.id === startId);
          if (idx >= 0) setCurrentIdx(idx);
        }
      } catch (e: any) {
        showAlert("Erreur", e.message || "Chargement impossible");
      } finally {
        setLoading(false);
      }
    })();
  }, [clientId, startId]);

  // ===== Music =====
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!info?.music_url || !musicEnabled) return;
      try {
        await Audio.setAudioModeAsync({
          playsInSilentModeIOS: true,
          shouldDuckAndroid: true,
          staysActiveInBackground: false,
        });
        const { sound } = await Audio.Sound.createAsync(
          { uri: `${BASE_URL}${info.music_url}` },
          { shouldPlay: playing, isLooping: true, volume: 0.7 }
        );
        if (cancelled) {
          sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
      } catch (e) {
        // silently fail
      }
    })();
    return () => {
      cancelled = true;
      if (soundRef.current) {
        soundRef.current.unloadAsync();
        soundRef.current = null;
      }
    };
  }, [info?.music_url, musicEnabled]);

  useEffect(() => {
    if (!soundRef.current) return;
    if (playing) soundRef.current.playAsync().catch(() => {});
    else soundRef.current.pauseAsync().catch(() => {});
  }, [playing]);

  // ===== Mode-specific animations =====
  const startKenBurns = useCallback(() => {
    kenBurnsAnim.setValue(0);
    Animated.timing(kenBurnsAnim, {
      toValue: 1,
      duration: speed,
      useNativeDriver: true,
    }).start();
  }, [kenBurnsAnim, speed]);

  const startStoryProgress = useCallback(() => {
    storyProgressAnim.setValue(0);
    Animated.timing(storyProgressAnim, {
      toValue: 1,
      duration: speed,
      useNativeDriver: false,
    }).start();
  }, [storyProgressAnim, speed]);

  // ===== Cast a photo to TV =====
  const castCurrentPhoto = useCallback(async (photo: PhotoOut) => {
    if (!castApi.connected || !photo) return;
    try {
      const url = photo.full_url.startsWith("http") ? photo.full_url : `${BASE_URL}${photo.full_url}`;
      await castApi.cast(url, "CINÉMARIÉS — Diaporama", photo.thumb_url);
    } catch (e) {
      // silently fail individual cast errors
    }
  }, [castApi]);

  // ===== Slideshow timer =====
  const nextSlide = useCallback(() => {
    if (photos.length === 0) return;
    if (mode === "classic") {
      Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
        setCurrentIdx((prev) => (prev + 1) % photos.length);
        Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
      });
    } else {
      setCurrentIdx((prev) => (prev + 1) % photos.length);
    }
  }, [photos.length, fadeAnim, mode]);

  useEffect(() => {
    if (!playing || photos.length === 0) return;
    // Trigger mode-specific animation when slide changes
    if (mode === "kenburns") startKenBurns();
    if (mode === "stories") startStoryProgress();
    // Cast current photo to TV if connected
    if (casting && castApi.connected && photos[currentIdx]) {
      castCurrentPhoto(photos[currentIdx]);
    }
    timerRef.current = setTimeout(nextSlide, speed);
    return () => clearTimeout(timerRef.current);
  }, [playing, currentIdx, speed, photos, mode, nextSlide, startKenBurns, startStoryProgress, casting, castApi.connected, castCurrentPhoto]);

  // ===== Auto-hide controls =====
  const showControlsTemporarily = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setControlsVisible(false), 4000);
  }, []);

  useEffect(() => {
    showControlsTemporarily();
    return () => {
      if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    };
  }, [showControlsTemporarily]);

  // ===== Manual nav =====
  const goPrev = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    setCurrentIdx((prev) => (prev - 1 + photos.length) % photos.length);
    showControlsTemporarily();
  };
  const goNext = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    nextSlide();
    showControlsTemporarily();
  };

  // ===== Cast toggle =====
  const handleCastToggle = async () => {
    if (!castApi.available) {
      const msg = Platform.OS === "web"
        ? "Chromecast disponible uniquement sur Chrome ou Edge desktop. Connectez-vous au même Wi-Fi que votre TV."
        : "Module Chromecast indisponible. Installez l'APK officielle CINÉMARIÉS pour utiliser Chromecast.";
      showAlert("Chromecast indisponible", msg);
      return;
    }
    if (castApi.connected) {
      await castApi.stop();
      setCasting(false);
      showAlert("Diffusion arrêtée", "Le diaporama reste sur votre téléphone.");
      return;
    }
    // Initialize cast with first photo
    if (photos[currentIdx]) {
      const url = photos[currentIdx].full_url.startsWith("http")
        ? photos[currentIdx].full_url
        : `${BASE_URL}${photos[currentIdx].full_url}`;
      const r = await castApi.cast(url, "CINÉMARIÉS — Diaporama", photos[currentIdx].thumb_url);
      if (r.ok) {
        setCasting(true);
        showAlert("📺 Diffusion lancée", "Le diaporama est maintenant sur votre TV !");
      } else {
        showAlert("Erreur Cast", r.error || "Impossible de démarrer la diffusion.");
      }
    }
  };

  if (loading || photos.length === 0) {
    return (
      <View style={s.container}>
        <View style={s.center}>
          {loading ? (
            <ActivityIndicator color={colors.gold} size="large" />
          ) : (
            <>
              <Ionicons name="images-outline" size={48} color={colors.textSecondary} />
              <Text style={s.empty}>Aucune photo</Text>
              <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
                <Text style={s.backTxt}>Retour</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    );
  }

  const current = photos[currentIdx];
  const currentUri = `${BASE_URL}${current.full_url}`;

  return (
    <View style={s.container}>
      <StatusBar hidden />

      {/* ===== Slide content (different per mode) ===== */}
      <TouchableOpacity
        activeOpacity={1}
        style={{ width: SCREEN_W, height: SCREEN_H }}
        onPress={showControlsTemporarily}
      >
        {mode === "classic" && (
          <Animated.View style={{ opacity: fadeAnim, width: "100%", height: "100%" }}>
            <Image
              source={{ uri: currentUri }}
              style={{ width: "100%", height: "100%" }}
              contentFit="contain"
              transition={200}
            />
          </Animated.View>
        )}

        {mode === "kenburns" && (
          <Animated.View
            style={{
              width: "100%",
              height: "100%",
              transform: [
                {
                  scale: kenBurnsAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [1.0, 1.18],
                  }),
                },
                {
                  translateX: kenBurnsAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, (currentIdx % 2 === 0 ? -1 : 1) * 30],
                  }),
                },
                {
                  translateY: kenBurnsAnim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0, (currentIdx % 3 === 0 ? -20 : 20)],
                  }),
                },
              ],
            }}
          >
            <Image
              source={{ uri: currentUri }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              transition={400}
            />
          </Animated.View>
        )}

        {mode === "stories" && (
          <View style={{ width: "100%", height: "100%" }}>
            <Image
              source={{ uri: currentUri }}
              style={{ width: "100%", height: "100%" }}
              contentFit="cover"
              transition={250}
            />
          </View>
        )}

        {mode === "mosaic" && (
          <MosaicView photos={photos} currentIdx={currentIdx} />
        )}
      </TouchableOpacity>

      {/* ===== Stories progress bars ===== */}
      {mode === "stories" && (
        <View style={s.storyBarsContainer}>
          {photos.slice(0, Math.min(photos.length, 10)).map((_, i) => {
            const activeIdx = currentIdx % photos.length;
            const isCurrent = i === Math.min(activeIdx, 9);
            const isPast = i < Math.min(activeIdx, 9);
            return (
              <View key={i} style={s.storyBarBg}>
                <Animated.View
                  style={[
                    s.storyBarFill,
                    {
                      width: isCurrent
                        ? storyProgressAnim.interpolate({ inputRange: [0, 1], outputRange: ["0%", "100%"] })
                        : isPast ? "100%" : "0%",
                    },
                  ]}
                />
              </View>
            );
          })}
        </View>
      )}

      {/* Side tap zones for prev/next */}
      <TouchableOpacity style={[s.sideTap, { left: 0 }]} onPress={goPrev} activeOpacity={1} />
      <TouchableOpacity style={[s.sideTap, { right: 0 }]} onPress={goNext} activeOpacity={1} />

      {/* ===== Controls overlay ===== */}
      {controlsVisible && (
        <>
          {/* Top bar */}
          <View style={[s.topBar, mode === "stories" && { paddingTop: 80 }]}>
            <TouchableOpacity onPress={() => router.back()} style={s.iconBtn}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={s.counter}>
              {currentIdx + 1} / {photos.length}
              {castApi.connected && (
                <Text style={{ color: colors.gold }}>  📺 {castApi.deviceName || "TV"}</Text>
              )}
            </Text>
            <View style={{ flexDirection: "row" }}>
              <TouchableOpacity
                onPress={handleCastToggle}
                style={s.iconBtn}
              >
                <Ionicons
                  name={castApi.connected ? "tv" : "tv-outline"}
                  size={26}
                  color={castApi.connected ? colors.gold : "#fff"}
                />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setMusicEnabled((v) => !v)}
                style={s.iconBtn}
              >
                <Ionicons
                  name={musicEnabled && info?.music_url ? "musical-notes" : "musical-notes-outline"}
                  size={26}
                  color={musicEnabled && info?.music_url ? colors.gold : "#fff"}
                />
              </TouchableOpacity>
            </View>
          </View>

          {/* Mode selector */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={s.modeSelector}
            contentContainerStyle={{ paddingHorizontal: spacing.md, gap: spacing.sm }}
          >
            {MODES.map((m) => (
              <TouchableOpacity
                key={m.id}
                onPress={() => setMode(m.id)}
                style={[s.modeChip, mode === m.id && s.modeChipActive]}
              >
                <Ionicons
                  name={m.icon}
                  size={16}
                  color={mode === m.id ? "#000" : "#fff"}
                />
                <Text style={[s.modeText, mode === m.id && s.modeTextActive]}>
                  {m.label}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* Bottom controls */}
          <View style={s.bottomBar}>
            <View style={s.speedRow}>
              {SPEED_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setSpeed(opt.value)}
                  style={[s.speedBtn, speed === opt.value && s.speedBtnActive]}
                >
                  <Text style={[s.speedTextSm, speed === opt.value && s.speedTextSmActive]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            <View style={s.playRow}>
              <TouchableOpacity onPress={goPrev} style={s.iconBtn}>
                <Ionicons name="play-skip-back" size={28} color="#fff" />
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() => setPlaying((v) => !v)}
                style={s.playBtn}
              >
                <Ionicons
                  name={playing ? "pause" : "play"}
                  size={32}
                  color="#000"
                />
              </TouchableOpacity>
              <TouchableOpacity onPress={goNext} style={s.iconBtn}>
                <Ionicons name="play-skip-forward" size={28} color="#fff" />
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}
    </View>
  );
}

// ===== Mosaic view : 4 photos en grille rotative =====
function MosaicView({ photos, currentIdx }: { photos: PhotoOut[]; currentIdx: number }) {
  // Show 4 photos: currentIdx, +1, +2, +3
  const items = [0, 1, 2, 3].map((offset) => {
    const idx = (currentIdx + offset) % photos.length;
    return photos[idx];
  });
  return (
    <View style={s.mosaicContainer}>
      <View style={s.mosaicRow}>
        <MosaicCell photo={items[0]} />
        <MosaicCell photo={items[1]} />
      </View>
      <View style={s.mosaicRow}>
        <MosaicCell photo={items[2]} />
        <MosaicCell photo={items[3]} />
      </View>
    </View>
  );
}
function MosaicCell({ photo }: { photo: PhotoOut }) {
  if (!photo) return <View style={s.mosaicCell} />;
  return (
    <View style={s.mosaicCell}>
      <Image
        source={{ uri: `${BASE_URL}${photo.thumb_url}` }}
        style={{ width: "100%", height: "100%" }}
        contentFit="cover"
        transition={300}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  empty: { color: colors.textSecondary, fontSize: 16 },
  backBtn: { paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, borderRadius: 999, backgroundColor: colors.gold, marginTop: spacing.md },
  backTxt: { color: "#000", fontWeight: "700" },
  sideTap: {
    position: "absolute", top: SCREEN_H * 0.2, bottom: SCREEN_H * 0.2,
    width: SCREEN_W * 0.2,
  },
  topBar: {
    position: "absolute", top: 0, left: 0, right: 0,
    paddingTop: 50, paddingBottom: spacing.sm, paddingHorizontal: spacing.sm,
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    backgroundColor: "rgba(0,0,0,0.5)",
  },
  counter: { color: "#fff", fontSize: 14, fontWeight: "600", flex: 1, textAlign: "center" },
  iconBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  modeSelector: {
    position: "absolute",
    top: 110,
    left: 0, right: 0,
    maxHeight: 44,
  },
  modeChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingHorizontal: spacing.md, paddingVertical: 8,
    borderRadius: 999, backgroundColor: "rgba(0,0,0,0.6)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.2)",
  },
  modeChipActive: {
    backgroundColor: colors.gold, borderColor: colors.gold,
  },
  modeText: { color: "#fff", fontSize: 12, fontWeight: "600" },
  modeTextActive: { color: "#000" },
  bottomBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingBottom: 40, paddingTop: spacing.md,
    backgroundColor: "rgba(0,0,0,0.5)",
    gap: spacing.md,
  },
  speedRow: { flexDirection: "row", justifyContent: "center", gap: spacing.sm },
  speedBtn: {
    paddingHorizontal: spacing.md, paddingVertical: 6,
    borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)",
  },
  speedBtnActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  speedTextSm: { color: "#fff", fontSize: 12 },
  speedTextSmActive: { color: "#000", fontWeight: "700" },
  playRow: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: spacing.lg,
  },
  playBtn: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: colors.gold,
    alignItems: "center", justifyContent: "center",
  },
  // Stories
  storyBarsContainer: {
    position: "absolute",
    top: 50, left: spacing.sm, right: spacing.sm,
    flexDirection: "row", gap: 4,
  },
  storyBarBg: {
    flex: 1, height: 3,
    backgroundColor: "rgba(255,255,255,0.3)",
    borderRadius: 2, overflow: "hidden",
  },
  storyBarFill: {
    height: "100%", backgroundColor: "#fff",
  },
  // Mosaic
  mosaicContainer: { width: "100%", height: "100%", padding: 4 },
  mosaicRow: { flex: 1, flexDirection: "row", gap: 4, marginBottom: 4 },
  mosaicCell: {
    flex: 1, borderRadius: radii.sm, overflow: "hidden",
    backgroundColor: "#111",
  },
});

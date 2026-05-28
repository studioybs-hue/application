/**
 * CINÉMARIÉS — Diaporama plein écran avec musique
 * Auto-play 3/5/10 sec par photo, musique en fond, Chromecast compatible
 */
import { useEffect, useState, useRef, useCallback } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  Dimensions, StatusBar, Animated,
} from "react-native";
import { Image } from "expo-image";
import { Ionicons } from "@expo/vector-icons";
import { useRouter, useLocalSearchParams } from "expo-router";
import { Audio, AVPlaybackStatus } from "expo-av";
import { api } from "@/src/api/client";
import { colors, spacing } from "@/src/theme";
import { showAlert } from "@/src/utils/dialog";

const BASE_URL = process.env.EXPO_PUBLIC_BACKEND_URL || "";
const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get("window");

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

const SPEED_OPTIONS = [
  { label: "3s", value: 3000 },
  { label: "5s", value: 5000 },
  { label: "10s", value: 10000 },
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

  const fadeAnim = useRef(new Animated.Value(1)).current;
  const soundRef = useRef<Audio.Sound | null>(null);
  const timerRef = useRef<any>(null);
  const controlsTimerRef = useRef<any>(null);

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

  // ===== Load music =====
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
        // Music load fail silently
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

  // ===== Sync play state with audio =====
  useEffect(() => {
    if (!soundRef.current) return;
    if (playing) soundRef.current.playAsync().catch(() => {});
    else soundRef.current.pauseAsync().catch(() => {});
  }, [playing]);

  // ===== Slideshow timer =====
  const nextSlide = useCallback(() => {
    if (photos.length === 0) return;
    Animated.timing(fadeAnim, { toValue: 0, duration: 300, useNativeDriver: true }).start(() => {
      setCurrentIdx((prev) => (prev + 1) % photos.length);
      Animated.timing(fadeAnim, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    });
  }, [photos.length, fadeAnim]);

  useEffect(() => {
    if (!playing || photos.length === 0) return;
    timerRef.current = setTimeout(nextSlide, speed);
    return () => clearTimeout(timerRef.current);
  }, [playing, currentIdx, speed, photos.length, nextSlide]);

  // ===== Auto-hide controls =====
  const showControlsTemporarily = useCallback(() => {
    setControlsVisible(true);
    if (controlsTimerRef.current) clearTimeout(controlsTimerRef.current);
    controlsTimerRef.current = setTimeout(() => setControlsVisible(false), 3000);
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
            </>
          )}
        </View>
      </View>
    );
  }

  const current = photos[currentIdx];

  return (
    <View style={s.container}>
      <StatusBar hidden />

      <TouchableOpacity
        activeOpacity={1}
        style={{ width: SCREEN_W, height: SCREEN_H }}
        onPress={showControlsTemporarily}
      >
        <Animated.View style={{ opacity: fadeAnim, width: "100%", height: "100%" }}>
          <Image
            source={{ uri: `${BASE_URL}${current.full_url}` }}
            style={{ width: "100%", height: "100%" }}
            contentFit="contain"
            transition={200}
          />
        </Animated.View>
      </TouchableOpacity>

      {/* Side tap zones for prev/next */}
      <TouchableOpacity
        style={[s.sideTap, { left: 0 }]}
        onPress={goPrev}
        activeOpacity={1}
      />
      <TouchableOpacity
        style={[s.sideTap, { right: 0 }]}
        onPress={goNext}
        activeOpacity={1}
      />

      {controlsVisible && (
        <>
          {/* Top bar */}
          <View style={s.topBar}>
            <TouchableOpacity onPress={() => router.back()} style={s.iconBtn}>
              <Ionicons name="close" size={28} color="#fff" />
            </TouchableOpacity>
            <Text style={s.counter}>
              {currentIdx + 1} / {photos.length}
            </Text>
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

          {/* Bottom controls */}
          <View style={s.bottomBar}>
            <View style={s.speedRow}>
              {SPEED_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.value}
                  onPress={() => setSpeed(opt.value)}
                  style={[s.speedBtn, speed === opt.value && s.speedBtnActive]}
                >
                  <Text style={[s.speedText, speed === opt.value && s.speedTextActive]}>
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

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#000" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md },
  empty: { color: colors.textSecondary, fontSize: 16 },
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
  counter: { color: "#fff", fontSize: 15, fontWeight: "600" },
  iconBtn: {
    width: 44, height: 44, alignItems: "center", justifyContent: "center",
  },
  bottomBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingBottom: 40, paddingTop: spacing.md,
    backgroundColor: "rgba(0,0,0,0.5)",
    gap: spacing.md,
  },
  speedRow: {
    flexDirection: "row", justifyContent: "center", gap: spacing.sm,
  },
  speedBtn: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: 999, borderWidth: 1, borderColor: "rgba(255,255,255,0.3)",
  },
  speedBtnActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  speedText: { color: "#fff", fontSize: 13 },
  speedTextActive: { color: "#000", fontWeight: "700" },
  playRow: {
    flexDirection: "row", justifyContent: "center", alignItems: "center", gap: spacing.lg,
  },
  playBtn: {
    width: 60, height: 60, borderRadius: 30, backgroundColor: colors.gold,
    alignItems: "center", justifyContent: "center",
  },
});

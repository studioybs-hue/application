// Native Cast hook — uses react-native-google-cast on iOS/Android (real native Cast).
// NOTE: This file is only loaded on native (iOS / Android) thanks to Metro's
// platform-specific resolution (.ts vs .web.ts). On web, /src/cast/index.web.ts is used.
//
// IMPORTANT: react-native-google-cast requires a NATIVE BUILD (EAS Build).
// It does NOT work in Expo Go. Use `eas build --profile preview --platform android`
// and install the APK on a real device.
//
// 🎬 BRANDED INTRO PRE-ROLL:
// Before every video cast, a 4-second branded intro (CINÉMARIÉS by Creativindustry)
// is queued first via Chromecast Queue API. The intro file lives at:
//   https://cinemaries.fr/api/uploads/intro.mp4
// (can be overridden with EXPO_PUBLIC_CAST_INTRO_URL env var)
import { useEffect, useState, useCallback, useRef } from "react";

let GoogleCast: any = null;
let CastButtonMod: any = null;
let CastState: any = null;
let useCastDeviceLib: any = null;
let useCastSessionLib: any = null;
let useMediaStatusLib: any = null;
let useRemoteMediaClientLib: any = null;

try {
  // Dynamically require so this file doesn't crash on a JS engine without the native module.
  const lib = require("react-native-google-cast");
  GoogleCast = lib.default || lib;
  CastButtonMod = lib.CastButton;
  CastState = lib.CastState;
  useCastDeviceLib = lib.useCastDevice;
  useCastSessionLib = lib.useCastSession;
  useMediaStatusLib = lib.useMediaStatus;
  useRemoteMediaClientLib = lib.useRemoteMediaClient;
} catch (e) {
  // Module not available (Expo Go / dev client without the plugin)
  GoogleCast = null;
}

type PendingMedia = { url: string; title: string; poster?: string };

// 🎬 Branded intro pre-roll (4 sec logo CINÉMARIÉS by Creativindustry)
const INTRO_URL =
  process.env.EXPO_PUBLIC_CAST_INTRO_URL ||
  "https://cinemaries.fr/api/uploads/intro.mp4";

// Detect if URL points to a video (intro should only play before videos, not photos)
const isVideoUrl = (url: string): boolean => {
  const lower = url.toLowerCase().split("?")[0];
  return (
    lower.endsWith(".mp4") ||
    lower.endsWith(".webm") ||
    lower.endsWith(".m3u8") ||
    lower.endsWith(".mov") ||
    lower.endsWith(".mkv")
  );
};

// Build a Chromecast mediaInfo from any URL (auto-detect content type)
const buildMediaInfo = (url: string, title: string, poster?: string) => {
  const lower = url.toLowerCase().split("?")[0];
  let contentType = "video/mp4";
  let metaType = "movie";
  if (lower.endsWith(".webm")) contentType = "video/webm";
  else if (lower.endsWith(".m3u8")) contentType = "application/x-mpegURL";
  else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    contentType = "image/jpeg";
    metaType = "photo";
  } else if (lower.endsWith(".png")) {
    contentType = "image/png";
    metaType = "photo";
  } else if (lower.endsWith(".webp")) {
    contentType = "image/webp";
    metaType = "photo";
  } else if (lower.endsWith(".mp3")) {
    contentType = "audio/mpeg";
    metaType = "musicTrack";
  } else if (lower.endsWith(".m4a") || lower.endsWith(".aac")) {
    contentType = "audio/aac";
    metaType = "musicTrack";
  }

  return {
    contentUrl: url,
    contentType,
    metadata: {
      type: metaType,
      title,
      images: poster ? [{ url: poster }] : undefined,
    },
  };
};

/**
 * Load media with optional branded intro pre-roll.
 * - For videos: queue intro.mp4 (4 sec) + main video
 * - For photos/audio: load directly without intro
 * Falls back gracefully if queue API fails.
 */
const loadWithBrandedIntro = async (
  rmc: any,
  url: string,
  title: string,
  poster?: string
): Promise<void> => {
  const mainMediaInfo = buildMediaInfo(url, title, poster);

  // Only prepend the intro for actual videos
  if (isVideoUrl(url)) {
    const introMediaInfo = buildMediaInfo(
      INTRO_URL,
      "CINÉMARIÉS",
      poster
    );
    try {
      // Use Cast Queue API: intro plays first, then automatically transitions to main video
      // Reference: https://developers.google.com/cast/docs/reference/web_sender/chrome.cast.media.QueueLoadRequest
      await rmc.loadMedia({
        mediaInfo: introMediaInfo,
        autoplay: true,
        queueData: {
          items: [
            { mediaInfo: introMediaInfo, autoplay: true, preloadTime: 0 },
            { mediaInfo: mainMediaInfo, autoplay: true, preloadTime: 2 },
          ],
          startIndex: 0,
          repeatMode: "OFF",
        },
      });
      return;
    } catch (e) {
      console.warn(
        "[cast] queueLoad with intro failed, falling back to single loadMedia",
        e
      );
      // Fall through to plain loadMedia
    }
  }

  // Plain single-media load (no intro)
  await rmc.loadMedia({
    mediaInfo: mainMediaInfo,
    autoplay: true,
  });
};

export function useCast() {
  const [available, setAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);
  const pendingMediaRef = useRef<PendingMedia | null>(null);

  // Hooks must be unconditional, so call them but ignore if lib missing
  const castDevice = useCastDeviceLib ? useCastDeviceLib() : null;
  const castSession = useCastSessionLib ? useCastSessionLib() : null;
  const remoteMediaClient = useRemoteMediaClientLib ? useRemoteMediaClientLib() : null;

  useEffect(() => {
    setAvailable(!!GoogleCast);
  }, []);

  // Track connection via cast device
  useEffect(() => {
    if (castDevice) {
      setConnected(true);
      setDeviceName(castDevice.friendlyName || "Chromecast");
    } else {
      setConnected(false);
      setDeviceName(null);
    }
  }, [castDevice]);

  // When a remote media client becomes available AND we have pending media → load it (with intro)
  useEffect(() => {
    const m = pendingMediaRef.current;
    if (remoteMediaClient && m) {
      pendingMediaRef.current = null;
      (async () => {
        try {
          await loadWithBrandedIntro(remoteMediaClient, m.url, m.title, m.poster);
        } catch (e) {
          console.warn("Cast loadMedia error", e);
        }
      })();
    }
  }, [remoteMediaClient]);

  const cast = useCallback(
    async (url: string, title: string, poster?: string): Promise<{ ok: boolean; error?: string }> => {
      if (!GoogleCast) {
        return {
          ok: false,
          error: "Module Chromecast non disponible. Cette fonctionnalité nécessite l'application installée via EAS Build.",
        };
      }
      try {
        // If already connected with an active media client, load right now (with intro)
        if (remoteMediaClient) {
          await loadWithBrandedIntro(remoteMediaClient, url, title, poster);
          return { ok: true };
        }

        // No active session — queue the media and show the device picker.
        // The effect above will pick it up automatically when the session becomes active.
        pendingMediaRef.current = { url, title, poster };
        await GoogleCast.showCastDialog?.();
        return { ok: true };
      } catch (e: any) {
        return { ok: false, error: e?.message || "Erreur Chromecast inconnue." };
      }
    },
    [remoteMediaClient]
  );

  /** Pre-queue media so that if user opens the native CastButton picker and selects a device,
   * the media will auto-load when the remote media client becomes available.
   * Call this whenever you display a video page. */
  const prepareMedia = useCallback(
    (url: string, title: string, poster?: string) => {
      pendingMediaRef.current = { url, title, poster };
    },
    []
  );

  const stop = useCallback(async () => {
    if (!GoogleCast) return;
    try {
      pendingMediaRef.current = null;
      await GoogleCast.SessionManager?.endCurrentSession?.(true);
    } catch (e) {
      console.warn("Cast stop error", e);
    }
  }, []);

  return { available, connected, deviceName, cast, stop, prepareMedia };
}

// Re-export the native CastButton so screens can use it directly if desired.
export const NativeCastButton = CastButtonMod;

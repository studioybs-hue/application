// Native Cast hook — uses react-native-google-cast on iOS/Android (real native Cast).
// NOTE: This file is only loaded on native (iOS / Android) thanks to Metro's
// platform-specific resolution (.ts vs .web.ts). On web, /src/cast/index.web.ts is used.
//
// IMPORTANT: react-native-google-cast requires a NATIVE BUILD (EAS Build).
// It does NOT work in Expo Go. Use `eas build --profile preview --platform android`
// and install the APK on a real device.
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

  // When a remote media client becomes available AND we have pending media → load it
  useEffect(() => {
    const m = pendingMediaRef.current;
    if (remoteMediaClient && m) {
      pendingMediaRef.current = null;
      (async () => {
        try {
          const lowerUrl = m.url.toLowerCase().split("?")[0];
          let contentType: string;
          if (lowerUrl.endsWith(".webm")) contentType = "video/webm";
          else if (lowerUrl.endsWith(".m3u8")) contentType = "application/x-mpegURL";
          else if (lowerUrl.endsWith(".jpg") || lowerUrl.endsWith(".jpeg")) contentType = "image/jpeg";
          else if (lowerUrl.endsWith(".png")) contentType = "image/png";
          else if (lowerUrl.endsWith(".webp")) contentType = "image/webp";
          else if (lowerUrl.endsWith(".mp3")) contentType = "audio/mpeg";
          else if (lowerUrl.endsWith(".m4a") || lowerUrl.endsWith(".aac")) contentType = "audio/aac";
          else contentType = "video/mp4";
          await remoteMediaClient.loadMedia({
            mediaInfo: {
              contentUrl: m.url,
              contentType,
              metadata: {
                type: "movie",
                title: m.title,
                images: m.poster ? [{ url: m.poster }] : undefined,
              },
            },
            autoplay: true,
          });
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
        // If already connected with an active media client, load right now
        if (remoteMediaClient) {
          const contentType = url.toLowerCase().endsWith(".webm")
            ? "video/webm"
            : url.toLowerCase().endsWith(".m3u8")
              ? "application/x-mpegURL"
              : "video/mp4";
          await remoteMediaClient.loadMedia({
            mediaInfo: {
              contentUrl: url,
              contentType,
              metadata: {
                type: "movie",
                title,
                images: poster ? [{ url: poster }] : undefined,
              },
            },
            autoplay: true,
          });
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

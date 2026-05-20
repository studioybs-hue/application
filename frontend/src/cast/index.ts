// Native Cast hook — uses react-native-google-cast on iOS/Android (real native Cast).
// NOTE: This file is only loaded on native (iOS / Android) thanks to Metro's
// platform-specific resolution (.ts vs .web.ts). On web, /src/cast/index.web.ts is used.
//
// IMPORTANT: react-native-google-cast requires a NATIVE BUILD (EAS Build).
// It does NOT work in Expo Go. Use `eas build --profile preview --platform android`
// and install the APK on a real device.
import { useEffect, useState, useCallback } from "react";

let GoogleCast: any = null;
let CastButtonMod: any = null;
let CastState: any = null;
let useCastDeviceLib: any = null;
let useCastSessionLib: any = null;
let useMediaStatusLib: any = null;

try {
  // Dynamically require so this file doesn't crash on a JS engine without the native module.
  const lib = require("react-native-google-cast");
  GoogleCast = lib.default || lib;
  CastButtonMod = lib.CastButton;
  CastState = lib.CastState;
  useCastDeviceLib = lib.useCastDevice;
  useCastSessionLib = lib.useCastSession;
  useMediaStatusLib = lib.useMediaStatus;
} catch (e) {
  // Module not available (Expo Go / dev client without the plugin)
  GoogleCast = null;
}

export function useCast() {
  const [available, setAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);

  // Hooks must be unconditional, so call them but ignore if lib missing
  const castDevice = useCastDeviceLib ? useCastDeviceLib() : null;
  const castSession = useCastSessionLib ? useCastSessionLib() : null;

  useEffect(() => {
    if (!GoogleCast) {
      setAvailable(false);
      return;
    }
    setAvailable(true);

    // Listen to cast state
    const sub = GoogleCast.SessionManager?.onSessionStarted?.(() => {
      setConnected(true);
    });
    const sub2 = GoogleCast.SessionManager?.onSessionEnded?.(() => {
      setConnected(false);
      setDeviceName(null);
    });

    return () => {
      try { sub?.remove?.(); } catch {}
      try { sub2?.remove?.(); } catch {}
    };
  }, []);

  useEffect(() => {
    if (castDevice) {
      setConnected(true);
      setDeviceName(castDevice.friendlyName || "Chromecast");
    } else {
      setConnected(false);
      setDeviceName(null);
    }
  }, [castDevice]);

  const cast = useCallback(
    async (url: string, title: string, poster?: string): Promise<{ ok: boolean; error?: string }> => {
      if (!GoogleCast) {
        return {
          ok: false,
          error: "Module Chromecast non disponible. Cette fonctionnalité nécessite l'application installée via EAS Build (pas Expo Go).",
        };
      }
      try {
        // Ensure session is active
        const session = await GoogleCast.SessionManager?.getCurrentCastSession?.();
        if (!session) {
          // Show the cast device picker
          await GoogleCast.showCastDialog?.();
          // Wait briefly for user to pick
          await new Promise((r) => setTimeout(r, 800));
          const s2 = await GoogleCast.SessionManager?.getCurrentCastSession?.();
          if (!s2) {
            return { ok: false, error: "Aucun appareil Chromecast sélectionné." };
          }
        }
        const activeSession = await GoogleCast.SessionManager?.getCurrentCastSession?.();
        if (!activeSession) {
          return { ok: false, error: "Pas de session Cast active." };
        }

        const contentType = url.toLowerCase().endsWith(".webm")
          ? "video/webm"
          : url.toLowerCase().endsWith(".m3u8")
            ? "application/x-mpegURL"
            : "video/mp4";

        await activeSession.loadMedia({
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
      } catch (e: any) {
        return { ok: false, error: e?.message || "Erreur Chromecast inconnue." };
      }
    },
    []
  );

  const stop = useCallback(async () => {
    if (!GoogleCast) return;
    try {
      await GoogleCast.SessionManager?.endCurrentSession?.(true);
    } catch (e) {
      console.warn("Cast stop error", e);
    }
  }, []);

  return { available, connected, deviceName, cast, stop };
}

// Re-export the native CastButton so screens can use it directly if desired.
export const NativeCastButton = CastButtonMod;

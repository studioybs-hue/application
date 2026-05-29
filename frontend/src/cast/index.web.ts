import { useEffect, useState, useCallback } from "react";

// Default Media Receiver – streams any URL without needing to register a custom app.
const APP_ID = "CC1AD845";

declare global {
  interface Window {
    __onGCastApiAvailable?: (available: boolean) => void;
    cast?: any;
    chrome?: any;
  }
}

let initStarted = false;
let initPromise: Promise<boolean> | null = null;

function initCastSdk(): Promise<boolean> {
  if (initPromise) return initPromise;
  initPromise = new Promise((resolve) => {
    if (typeof window === "undefined" || typeof document === "undefined") {
      return resolve(false);
    }
    // Quick UA check – Google Cast Web SDK officially supports Chrome / Edge desktop only.
    const ua = (navigator.userAgent || "").toLowerCase();
    const isChromium = /chrome|crios|edg/.test(ua) && !/firefox/.test(ua);
    if (!isChromium) return resolve(false);

    initStarted = true;

    window.__onGCastApiAvailable = (available: boolean) => {
      if (!available) return resolve(false);
      try {
        const context = window.cast.framework.CastContext.getInstance();
        context.setOptions({
          receiverApplicationId: APP_ID,
          autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });
        resolve(true);
      } catch (e) {
        console.warn("Cast init error", e);
        resolve(false);
      }
    };

    const script = document.createElement("script");
    script.src = "https://www.gstatic.com/cv/js/sender/v1/cast_sender.js?loadCastFramework=1";
    script.async = true;
    script.onerror = () => resolve(false);
    document.head.appendChild(script);

    // Safety timeout (10s)
    setTimeout(() => resolve(false), 10000);
  });
  return initPromise;
}

export function useCast() {
  const [available, setAvailable] = useState(false);
  const [connected, setConnected] = useState(false);
  const [deviceName, setDeviceName] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    initCastSdk().then((ok) => {
      if (!mounted) return;
      setAvailable(ok);
      if (!ok) return;

      const context = window.cast.framework.CastContext.getInstance();
      const updateState = () => {
        try {
          const session = context.getCurrentSession();
          setConnected(!!session);
          if (session) {
            try {
              const dev = session.getCastDevice();
              setDeviceName(dev?.friendlyName || "Chromecast");
            } catch {
              setDeviceName("Chromecast");
            }
          } else {
            setDeviceName(null);
          }
        } catch {
          // ignore
        }
      };

      context.addEventListener(
        window.cast.framework.CastContextEventType.SESSION_STATE_CHANGED,
        updateState
      );
      updateState();
    });
    return () => {
      mounted = false;
    };
  }, []);

  const cast = useCallback(
    async (url: string, title: string, poster?: string): Promise<{ ok: boolean; error?: string }> => {
      if (!available || !window.cast || !window.chrome) {
        return { ok: false, error: "Chromecast non disponible dans ce navigateur." };
      }
      try {
        // Resolve to absolute URL (Chromecast cannot handle relative paths)
        let absoluteUrl = url;
        if (absoluteUrl.startsWith("/")) {
          absoluteUrl = (typeof window !== "undefined" ? window.location.origin : "") + absoluteUrl;
        }
        if (!absoluteUrl.startsWith("http")) {
          return { ok: false, error: "URL vidéo invalide." };
        }

        // Detect content type from extension
        const lower = absoluteUrl.toLowerCase().split("?")[0];
        let contentType = "video/mp4";
        if (lower.endsWith(".m3u8")) contentType = "application/x-mpegURL";
        else if (lower.endsWith(".mpd")) contentType = "application/dash+xml";
        else if (lower.endsWith(".webm")) contentType = "video/webm";
        else if (lower.endsWith(".mov")) contentType = "video/quicktime";
        else if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) contentType = "image/jpeg";
        else if (lower.endsWith(".png")) contentType = "image/png";
        else if (lower.endsWith(".webp")) contentType = "image/webp";
        else if (lower.endsWith(".gif")) contentType = "image/gif";
        else if (lower.endsWith(".mp3")) contentType = "audio/mpeg";
        else if (lower.endsWith(".m4a") || lower.endsWith(".aac")) contentType = "audio/aac";
        else if (lower.endsWith(".wav")) contentType = "audio/wav";

        const context = window.cast.framework.CastContext.getInstance();
        let session = context.getCurrentSession();
        if (!session) {
          await context.requestSession();
          session = context.getCurrentSession();
        }
        if (!session) return { ok: false, error: "Aucun appareil Chromecast sélectionné." };

        const mediaInfo = new window.chrome.cast.media.MediaInfo(absoluteUrl, contentType);
        mediaInfo.metadata = new window.chrome.cast.media.GenericMediaMetadata();
        mediaInfo.metadata.title = title;
        if (poster) {
          mediaInfo.metadata.images = [new window.chrome.cast.Image(poster)];
        }
        const request = new window.chrome.cast.media.LoadRequest(mediaInfo);

        try {
          await session.loadMedia(request);
          return { ok: true };
        } catch (loadErr: any) {
          console.error("Cast loadMedia error:", loadErr);
          // The receiver returns an error code if it can't play the file
          const code = loadErr?.code || "";
          const desc = loadErr?.description || loadErr?.message || "";
          let hint = "";
          if (code === "load_failed" || /load.?fail/i.test(desc)) {
            hint = "Le fichier vidéo ne peut pas être lu par votre Chromecast. Causes possibles : format/codec non supporté, fichier trop volumineux, ou serveur lent.";
          } else if (/timeout/i.test(desc)) {
            hint = "Délai dépassé pendant la mise en mémoire tampon.";
          } else if (/cancel/i.test(desc)) {
            hint = "Diffusion annulée.";
          }
          return { ok: false, error: `${hint || desc || "Erreur de chargement"}\n\n(URL : ${absoluteUrl})` };
        }
      } catch (e: any) {
        console.error("Cast error", e);
        return { ok: false, error: e?.message || "Erreur Chromecast" };
      }
    },
    [available]
  );

  const stop = useCallback(async () => {
    if (!available || !window.cast) return;
    try {
      const context = window.cast.framework.CastContext.getInstance();
      const session = context.getCurrentSession();
      if (session) session.endSession(true);
    } catch (e) {
      console.warn(e);
    }
  }, [available]);

  // Web stub for prepareMedia (used on native to pre-queue media before tap on native CastButton)
  const prepareMedia = useCallback((_url: string, _title: string, _poster?: string) => {
    // no-op on web — user invokes cast() directly via custom button
  }, []);

  return { available, connected, deviceName, cast, stop, prepareMedia };
}

// Web has no native CastButton; export null so the video page can fallback to its custom button.
export const NativeCastButton = null as any;

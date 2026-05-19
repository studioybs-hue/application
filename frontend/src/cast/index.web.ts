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
    async (url: string, title: string, poster?: string): Promise<boolean> => {
      if (!available || !window.cast || !window.chrome) return false;
      try {
        const context = window.cast.framework.CastContext.getInstance();
        let session = context.getCurrentSession();
        if (!session) {
          await context.requestSession();
          session = context.getCurrentSession();
        }
        if (!session) return false;

        const mediaInfo = new window.chrome.cast.media.MediaInfo(url, "video/mp4");
        mediaInfo.metadata = new window.chrome.cast.media.GenericMediaMetadata();
        mediaInfo.metadata.title = title;
        if (poster) {
          mediaInfo.metadata.images = [new window.chrome.cast.Image(poster)];
        }
        const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
        await session.loadMedia(request);
        return true;
      } catch (e) {
        console.error("Cast error", e);
        return false;
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

  return { available, connected, deviceName, cast, stop };
}

/**
 * Push notifications helper for CINÉMARIÉS.
 *
 * - Web platform → no-op (Expo Push doesn't support web)
 * - iOS/Android → request permission, get Expo Push Token, register it on the backend
 *
 * Called from AuthContext after login/refresh.
 */
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { api } from "@/src/api/client";

let _registering = false;
let _lastRegisteredToken: string | null = null;

// Foreground display handler — show banner + play sound when app is open
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    // Older expo-notifications API compatibility:
    shouldShowAlert: true,
  } as any),
});

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  if (!Device.isDevice) {
    // Simulators don't support push notifications
    return null;
  }
  if (_registering) return _lastRegisteredToken;
  _registering = true;
  try {
    // Android needs a notification channel for sounds/heads-up
    if (Platform.OS === "android") {
      try {
        await Notifications.setNotificationChannelAsync("default", {
          name: "Notifications CINÉMARIÉS",
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#D4AF37",
          sound: "default",
        });
      } catch {}
    }

    const existing = await Notifications.getPermissionsAsync();
    let status = existing.status;
    if (status !== "granted") {
      const req = await Notifications.requestPermissionsAsync();
      status = req.status;
    }
    if (status !== "granted") return null;

    // Get the Expo Push Token (needs a projectId in development build)
    const projectId =
      Constants?.expoConfig?.extra?.eas?.projectId ||
      (Constants as any)?.easConfig?.projectId ||
      undefined;
    const tokenRes = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    const token = tokenRes?.data || null;
    if (!token) return null;

    _lastRegisteredToken = token;
    try {
      await api("/notifications/register-token", {
        method: "POST",
        body: {
          expo_push_token: token,
          platform: Platform.OS,
          device_id: Constants?.sessionId || undefined,
        },
      });
    } catch (e) {
      // Silent fail — we'll retry on next login
      console.warn("[push] register-token failed", e);
    }
    return token;
  } catch (e) {
    console.warn("[push] registerForPushNotificationsAsync error", e);
    return null;
  } finally {
    _registering = false;
  }
}

export async function unregisterPushNotificationsAsync(): Promise<void> {
  if (Platform.OS === "web") return;
  try {
    if (_lastRegisteredToken) {
      await api(`/notifications/token?token=${encodeURIComponent(_lastRegisteredToken)}`, {
        method: "DELETE",
      });
    } else {
      // No specific token? Wipe all of user's tokens (best-effort).
      await api(`/notifications/token`, { method: "DELETE" });
    }
  } catch {}
  _lastRegisteredToken = null;
}

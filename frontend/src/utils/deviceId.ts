import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

const KEY = "cinemaries.device_id";

function genUuid(): string {
  // RFC4122-ish (good enough for client device tagging)
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached) return cached;
  try {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined" && window.localStorage) {
        let id = window.localStorage.getItem(KEY);
        if (!id) {
          id = genUuid();
          window.localStorage.setItem(KEY, id);
        }
        cached = id;
        return id;
      }
    } else {
      // Native: try SecureStore first
      try {
        let id = await SecureStore.getItemAsync(KEY);
        if (!id) {
          id = genUuid();
          await SecureStore.setItemAsync(KEY, id);
        }
        cached = id;
        return id;
      } catch {
        // fallback to AsyncStorage
      }
      let id = await AsyncStorage.getItem(KEY);
      if (!id) {
        id = genUuid();
        await AsyncStorage.setItem(KEY, id);
      }
      cached = id;
      return id;
    }
  } catch (e) {
    console.warn("getDeviceId failed", e);
  }
  cached = genUuid();
  return cached;
}

export function getDeviceLabel(): string {
  if (Platform.OS === "web" && typeof navigator !== "undefined") {
    const ua = navigator.userAgent || "";
    if (/iPhone|iPad|iPod/.test(ua)) return "iPhone/iPad (Web)";
    if (/Android/.test(ua)) return "Android (Web)";
    if (/Macintosh/.test(ua)) return "Mac";
    if (/Windows/.test(ua)) return "PC Windows";
    if (/Linux/.test(ua)) return "Linux";
    return "Navigateur Web";
  }
  return Platform.OS === "ios" ? "iPhone/iPad" : Platform.OS === "android" ? "Android" : "Appareil";
}

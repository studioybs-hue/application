import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { useEffect } from "react";
import * as NavigationBar from "expo-navigation-bar";
import { AuthProvider } from "@/src/auth/AuthContext";
import { ConfirmProvider } from "@/src/ui/ConfirmDialog";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { colors } from "@/src/theme";
import { CookieNotice } from "@/src/ui/CookieNotice";

export default function RootLayout() {
  const router = useRouter();
  // Immersive mode on Android: hide the system navigation bar (Home / Back / Recent)
  // The bar reappears with a swipe and auto-hides after a moment.
  useEffect(() => {
    if (Platform.OS === "android") {
      (async () => {
        try {
          await NavigationBar.setVisibilityAsync("hidden");
          await NavigationBar.setBehaviorAsync("overlay-swipe");
          await NavigationBar.setBackgroundColorAsync(colors.bg);
          await NavigationBar.setButtonStyleAsync("light");
        } catch (e) {
          // Silent fail if not supported (e.g. tablets with gesture nav only)
        }
      })();
    }
  }, []);

  // Handle push notification taps — navigate to deep link in `data.path`
  useEffect(() => {
    if (Platform.OS === "web") return;
    let sub: { remove?: () => void } | null = null;
    (async () => {
      try {
        const Notifications = await import("expo-notifications");
        // App opened FROM notification (cold start)
        const last = await Notifications.getLastNotificationResponseAsync();
        const handle = (response: any) => {
          try {
            const data = response?.notification?.request?.content?.data || {};
            const path = data?.path;
            if (path && typeof path === "string") {
              setTimeout(() => router.push(path as any), 250);
            }
          } catch {}
        };
        if (last) handle(last);
        const listener = Notifications.addNotificationResponseReceivedListener(handle);
        sub = listener;
      } catch {}
    })();
    return () => {
      try { sub?.remove?.(); } catch {}
    };
  }, [router]);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
      <SafeAreaProvider>
        <AuthProvider>
          <ConfirmProvider>
            <StatusBar style="light" hidden={false} translucent />
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.bg },
                animation: "fade",
              }}
            />
            <CookieNotice />
          </ConfirmProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

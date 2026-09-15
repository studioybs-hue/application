import { Stack, useRouter, usePathname } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { useEffect } from "react";
import * as NavigationBar from "expo-navigation-bar";
import { AuthProvider, useAuth } from "@/src/auth/AuthContext";
import { ConfirmProvider } from "@/src/ui/ConfirmDialog";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { colors } from "@/src/theme";
import { CookieNotice } from "@/src/ui/CookieNotice";
import { RootErrorBoundary } from "@/src/components/RootErrorBoundary";

function DeactivationGuard() {
  const router = useRouter();
  const pathname = usePathname();
  const { user, loading } = useAuth();
  useEffect(() => {
    if (loading || !user) return;
    const isInactive = (user as any).is_active === false;
    const allowed =
      !pathname ||
      pathname.startsWith("/account-deactivated") ||
      pathname.startsWith("/auth") ||
      pathname.startsWith("/legal");
    if (isInactive && !allowed) {
      router.replace("/account-deactivated");
    }
  }, [user, loading, pathname, router]);
  return null;
}

export default function RootLayout() {
  const router = useRouter();
  useEffect(() => {
    if (Platform.OS === "android") {
      (async () => {
        try {
          await NavigationBar.setVisibilityAsync("hidden");
          await NavigationBar.setBehaviorAsync("overlay-swipe");
          await NavigationBar.setBackgroundColorAsync(colors.bg);
          await NavigationBar.setButtonStyleAsync("light");
        } catch (e) {
          // Silent fail if not supported
        }
      })();
    }
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let sub: { remove?: () => void } | null = null;
    (async () => {
      try {
        const Notifications = await import("expo-notifications");
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
    <RootErrorBoundary>
      <GestureHandlerRootView style={{ flex: 1, backgroundColor: colors.bg }}>
        <SafeAreaProvider>
          <AuthProvider>
            <ConfirmProvider>
              <DeactivationGuard />
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
    </RootErrorBoundary>
  );
}

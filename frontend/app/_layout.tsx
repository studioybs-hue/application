import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { useEffect } from "react";
import * as NavigationBar from "expo-navigation-bar";
import { AuthProvider } from "@/src/auth/AuthContext";
import { ConfirmProvider } from "@/src/ui/ConfirmDialog";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { colors } from "@/src/theme";

export default function RootLayout() {
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
          </ConfirmProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

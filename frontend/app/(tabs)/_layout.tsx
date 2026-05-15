import { Tabs } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors } from "@/src/theme";
import { Platform } from "react-native";

const HomeIcon = ({ color, size }: { color: string; size: number }) => (
  <Ionicons name="film-outline" size={size} color={color} />
);
const LibIcon = ({ color, size }: { color: string; size: number }) => (
  <Ionicons name="bookmark-outline" size={size} color={color} />
);
const ProfileIcon = ({ color, size }: { color: string; size: number }) => (
  <Ionicons name="person-circle-outline" size={size} color={color} />
);

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.gold,
        tabBarInactiveTintColor: colors.textSecondary,
        tabBarStyle: {
          backgroundColor: "#0A0A0A",
          borderTopColor: "rgba(212,175,55,0.15)",
          borderTopWidth: 0.5,
          height: Platform.OS === "ios" ? 86 : 68,
          paddingTop: 8,
          paddingBottom: Platform.OS === "ios" ? 28 : 12,
        },
        tabBarLabelStyle: { fontSize: 11, letterSpacing: 0.5 },
      }}
    >
      <Tabs.Screen name="home" options={{ title: "Accueil", tabBarIcon: HomeIcon }} />
      <Tabs.Screen name="library" options={{ title: "Ma Bibliothèque", tabBarIcon: LibIcon }} />
      <Tabs.Screen name="profile" options={{ title: "Profil", tabBarIcon: ProfileIcon }} />
    </Tabs>
  );
}

import { useEffect } from "react";
import { View, ActivityIndicator, Text, StyleSheet } from "react-native";
import { useRouter } from "expo-router";
import { useAuth } from "@/src/auth/AuthContext";
import { colors } from "@/src/theme";

export default function Index() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    if (user) router.replace("/(tabs)/home");
    else router.replace("/(tabs)/home");
  }, [user, loading, router]);

  return (
    <View style={styles.container} testID="splash-screen">
      <Text style={styles.brand}>CINÉMARIÉS</Text>
      <Text style={styles.tagline}>Le cinéma de votre plus beau jour</Text>
      <ActivityIndicator color={colors.gold} style={{ marginTop: 24 }} />
      <Text style={styles.footer}>by Creative Industry France</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  brand: {
    color: colors.gold,
    fontSize: 36,
    letterSpacing: 8,
    fontWeight: "700",
  },
  tagline: {
    color: colors.ivory,
    fontSize: 13,
    letterSpacing: 2,
    fontStyle: "italic",
    marginTop: 10,
    opacity: 0.85,
  },
  footer: {
    position: "absolute",
    bottom: 40,
    color: colors.textDisabled,
    fontSize: 11,
    letterSpacing: 1.5,
  },
});

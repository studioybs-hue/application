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
      <Text style={styles.brand}>WEDDING</Text>
      <Text style={styles.brand2}>STREAM</Text>
      <ActivityIndicator color={colors.gold} style={{ marginTop: 24 }} />
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
    color: colors.ivory,
    fontSize: 32,
    letterSpacing: 6,
    fontWeight: "300",
  },
  brand2: {
    color: colors.gold,
    fontSize: 32,
    letterSpacing: 6,
    fontWeight: "700",
    marginTop: 4,
  },
});

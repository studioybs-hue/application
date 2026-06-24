/**
 * iOS Reader App Gate — App Store Guideline 3.1.1 compliance.
 *
 * Displays a full-screen "not available on iOS" notice for routes that
 * would normally trigger external payment or unlock-by-code flows.
 *
 * On Web + Android: returns null so the parent screen renders normally.
 * On iOS native: returns a polite informational screen with no buttons
 * that direct users to external purchase pages (we don't link to the
 * website — Apple forbids steering. The user must open Safari themselves).
 */

import { View, Text, StyleSheet, TouchableOpacity } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, spacing, radii } from "@/src/theme";
import { IS_IOS_NATIVE } from "@/src/utils/platform";

type Props = {
  title: string;
  message: string;
  /** Optional extra text shown below the main message */
  hint?: string;
};

export default function IOSReaderGate({ title, message, hint }: Props) {
  const router = useRouter();
  if (!IS_IOS_NATIVE) return null;

  return (
    <SafeAreaView style={styles.root} edges={["top", "left", "right"]}>
      <TouchableOpacity style={styles.backBtn} onPress={() => router.back()} testID="ios-gate-back">
        <Ionicons name="chevron-back" size={22} color={colors.ivory} />
        <Text style={styles.backTxt}>Retour</Text>
      </TouchableOpacity>
      <View style={styles.body}>
        <View style={styles.iconCircle}>
          <Ionicons name="information-circle-outline" size={42} color={colors.gold} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  backBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    gap: 4,
  },
  backTxt: { color: colors.ivory, fontSize: 16, fontWeight: "500" },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
  },
  iconCircle: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: "rgba(212,175,55,0.12)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.lg,
  },
  title: {
    color: colors.ivory,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: spacing.md,
  },
  message: {
    color: colors.textSecondary,
    fontSize: 15,
    textAlign: "center",
    lineHeight: 22,
    marginBottom: spacing.md,
  },
  hint: {
    color: colors.textDisabled,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 17,
    marginTop: spacing.sm,
    fontStyle: "italic",
  },
});

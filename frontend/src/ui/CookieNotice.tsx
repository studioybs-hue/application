import { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Platform } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, spacing, radii } from "@/src/theme";

const STORAGE_KEY = "cinemaries_cookie_notice_dismissed_v1";

/**
 * Informative cookie notice (NOT a consent banner) — required by CNIL guidelines
 * for sites using only strictly-necessary cookies (no consent needed but transparency required).
 * Dismissed permanently after first click on "J'ai compris".
 */
export function CookieNotice() {
  const router = useRouter();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (Platform.OS !== "web") return; // only show on web (mobile app has no cookies)
    try {
      const dismissed = typeof window !== "undefined" && window.localStorage.getItem(STORAGE_KEY);
      if (!dismissed) setVisible(true);
    } catch {}
  }, []);

  const dismiss = () => {
    try {
      if (typeof window !== "undefined") window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {}
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.banner}>
        <View style={styles.iconWrap}>
          <Ionicons name="shield-checkmark" size={20} color={colors.gold} />
        </View>
        <View style={styles.textWrap}>
          <Text style={styles.title}>Cookies strictement nécessaires</Text>
          <Text style={styles.body}>
            CINÉMARIÉS n'utilise <Text style={styles.bold}>aucun tracker publicitaire ni analytics</Text>. Seuls les cookies essentiels au fonctionnement (session de connexion, identifiant d'appareil) sont utilisés. Conformément à la CNIL, votre consentement n'est pas requis.
          </Text>
          <View style={styles.actions}>
            <TouchableOpacity onPress={() => router.push("/legal/privacy")}>
              <Text style={styles.link}>En savoir plus</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btn} onPress={dismiss} testID="cookie-notice-dismiss">
              <Text style={styles.btnTxt}>J'ai compris</Text>
            </TouchableOpacity>
          </View>
        </View>
        <TouchableOpacity onPress={dismiss} style={styles.close} hitSlop={{ top: 10, left: 10, right: 10, bottom: 10 }}>
          <Ionicons name="close" size={18} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    bottom: 16,
    left: 16,
    right: 16,
    alignItems: "center",
    zIndex: 9999,
  },
  banner: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.gold,
    borderRadius: radii.md,
    padding: spacing.md,
    maxWidth: 600,
    width: "100%",
    gap: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 12,
  },
  iconWrap: { width: 40, height: 40, borderRadius: 20, backgroundColor: "rgba(212,175,55,0.12)", alignItems: "center", justifyContent: "center" },
  textWrap: { flex: 1, gap: 6 },
  title: { color: colors.ivory, fontSize: 14, fontWeight: "700" },
  body: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },
  bold: { color: colors.ivory, fontWeight: "700" },
  actions: { flexDirection: "row", alignItems: "center", marginTop: 8, gap: 14, flexWrap: "wrap" },
  link: { color: colors.gold, fontSize: 12, fontWeight: "600", textDecorationLine: "underline" },
  btn: { backgroundColor: colors.gold, paddingHorizontal: 14, paddingVertical: 7, borderRadius: 4 },
  btnTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 12 },
  close: { position: "absolute", top: 8, right: 8, padding: 4 },
});

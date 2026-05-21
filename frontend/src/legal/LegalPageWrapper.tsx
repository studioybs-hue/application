import { ReactNode } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Linking,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radii } from "@/src/theme";
import { COMPANY } from "./companyInfo";

interface Props {
  title: string;
  subtitle?: string;
  lastUpdate?: string;
  children: ReactNode;
}

export function LegalPageWrapper({ title, subtitle, lastUpdate, children }: Props) {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  return (
    <View style={styles.root}>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* Header */}
          <View style={styles.headerRow}>
            <TouchableOpacity
              onPress={() => (router.canGoBack() ? router.back() : router.replace("/(tabs)/home"))}
              style={styles.backBtn}
              testID="legal-back"
            >
              <Ionicons name="chevron-back" size={24} color={colors.ivory} />
              <Text style={styles.backTxt}>Retour</Text>
            </TouchableOpacity>
            <Text style={styles.brand}>{COMPANY.brand}</Text>
          </View>

          <View style={[styles.content, isWide && { maxWidth: 820, alignSelf: "center", width: "100%" }]}>
            <Text style={styles.title}>{title}</Text>
            {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            {lastUpdate ? (
              <Text style={styles.updated}>Dernière mise à jour : {lastUpdate}</Text>
            ) : null}

            <View style={styles.divider} />

            {children}

            {/* Footer with related links */}
            <View style={styles.footer}>
              <Text style={styles.footerTitle}>Documents légaux</Text>
              <View style={styles.footerLinks}>
                <FooterLink label="Mentions légales" href="/legal/mentions" />
                <FooterLink label="Politique de confidentialité" href="/legal/privacy" />
                <FooterLink label="CGU" href="/legal/cgu" />
                <FooterLink label="CGV" href="/legal/cgv" />
              </View>
              <TouchableOpacity onPress={() => Linking.openURL(`mailto:${COMPANY.email}`)}>
                <Text style={styles.contactLink}>
                  <Ionicons name="mail-outline" size={13} color={colors.gold} /> {COMPANY.email}
                </Text>
              </TouchableOpacity>
              <Text style={styles.copyright}>
                © {new Date().getFullYear()} {COMPANY.legalName} — Tous droits réservés
              </Text>
            </View>
          </View>
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

function FooterLink({ label, href }: { label: string; href: string }) {
  const router = useRouter();
  return (
    <TouchableOpacity onPress={() => router.push(href as any)}>
      <Text style={styles.footerLink}>{label}</Text>
    </TouchableOpacity>
  );
}

// --- Rich helpers used inside legal pages ---

export function H2({ children }: { children: ReactNode }) {
  return <Text style={styles.h2}>{children}</Text>;
}

export function H3({ children }: { children: ReactNode }) {
  return <Text style={styles.h3}>{children}</Text>;
}

export function P({ children }: { children: ReactNode }) {
  return <Text style={styles.p}>{children}</Text>;
}

export function Bold({ children }: { children: ReactNode }) {
  return <Text style={{ fontWeight: "700", color: colors.ivory }}>{children}</Text>;
}

export function Bullet({ children }: { children: ReactNode }) {
  return (
    <View style={styles.bulletRow}>
      <Text style={styles.bulletDot}>•</Text>
      <Text style={styles.bulletTxt}>{children}</Text>
    </View>
  );
}

export function InfoBox({ children }: { children: ReactNode }) {
  return (
    <View style={styles.infoBox}>
      <Ionicons name="information-circle" size={18} color={colors.gold} />
      <Text style={styles.infoTxt}>{children}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl * 2 },

  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  backBtn: { flexDirection: "row", alignItems: "center", padding: 8, gap: 2 },
  backTxt: { color: colors.ivory, fontSize: 15, fontWeight: "600" },
  brand: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 3 },

  content: { paddingHorizontal: 4 },
  title: { color: colors.ivory, fontSize: 28, fontWeight: "800", marginTop: spacing.md, lineHeight: 34 },
  subtitle: { color: colors.textSecondary, fontSize: 14, marginTop: 6, lineHeight: 20 },
  updated: { color: colors.textDisabled, fontSize: 12, marginTop: spacing.sm, fontStyle: "italic" },

  divider: { height: 1, backgroundColor: "rgba(255,255,255,0.08)", marginVertical: spacing.lg },

  h2: { color: colors.gold, fontSize: 18, fontWeight: "700", marginTop: spacing.lg, marginBottom: spacing.sm, letterSpacing: 0.2 },
  h3: { color: colors.ivory, fontSize: 15, fontWeight: "700", marginTop: spacing.md, marginBottom: 6 },
  p: { color: colors.textSecondary, fontSize: 14, lineHeight: 22, marginBottom: spacing.sm },

  bulletRow: { flexDirection: "row", marginBottom: 8, paddingLeft: 4 },
  bulletDot: { color: colors.gold, fontSize: 16, lineHeight: 22, marginRight: 8, width: 12 },
  bulletTxt: { color: colors.textSecondary, fontSize: 14, lineHeight: 22, flex: 1 },

  infoBox: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    padding: spacing.md,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.3)",
    backgroundColor: "rgba(212,175,55,0.05)",
    marginVertical: spacing.sm,
  },
  infoTxt: { color: colors.ivory, fontSize: 13, lineHeight: 20, flex: 1 },

  footer: {
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
  },
  footerTitle: { color: colors.textSecondary, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", marginBottom: spacing.sm },
  footerLinks: { flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 12, marginBottom: spacing.md },
  footerLink: { color: colors.gold, fontSize: 13, fontWeight: "500", paddingHorizontal: 6, paddingVertical: 4 },
  contactLink: { color: colors.gold, fontSize: 13, marginTop: 4 },
  copyright: { color: colors.textDisabled, fontSize: 11, marginTop: spacing.md, textAlign: "center" },
});

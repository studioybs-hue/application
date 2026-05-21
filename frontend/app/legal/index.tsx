import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radii } from "@/src/theme";
import { COMPANY } from "@/src/legal/companyInfo";

export default function LegalIndex() {
  const router = useRouter();
  const items = [
    { icon: "business-outline", label: "Mentions légales", desc: "Identité de l'éditeur, hébergeur, directeur de publication", href: "/legal/mentions" },
    { icon: "shield-checkmark-outline", label: "Politique de confidentialité", desc: "Données collectées, RGPD, vos droits", href: "/legal/privacy" },
    { icon: "document-text-outline", label: "Conditions Générales d'Utilisation (CGU)", desc: "Règles d'usage du service", href: "/legal/cgu" },
    { icon: "receipt-outline", label: "Conditions Générales de Vente (CGV)", desc: "Abonnement Premium, hébergement 90€, remboursement", href: "/legal/cgv" },
  ];
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ScrollView contentContainerStyle={{ padding: spacing.md }}>
        <View style={styles.headerRow}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.ivory} />
            <Text style={styles.backTxt}>Retour</Text>
          </TouchableOpacity>
          <Text style={styles.brand}>{COMPANY.brand}</Text>
        </View>
        <Text style={styles.title}>Documents légaux</Text>
        <Text style={styles.subtitle}>Toutes les informations légales de {COMPANY.legalName}.</Text>
        <View style={{ marginTop: spacing.lg, gap: spacing.sm }}>
          {items.map((it) => (
            <TouchableOpacity key={it.href} style={styles.card} onPress={() => router.push(it.href as any)}>
              <View style={styles.iconWrap}>
                <Ionicons name={it.icon as any} size={22} color={colors.gold} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemLabel}>{it.label}</Text>
                <Text style={styles.itemDesc}>{it.desc}</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: spacing.md },
  backBtn: { flexDirection: "row", alignItems: "center", padding: 8, gap: 2 },
  backTxt: { color: colors.ivory, fontSize: 15, fontWeight: "600" },
  brand: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 3 },
  title: { color: colors.ivory, fontSize: 28, fontWeight: "800", marginTop: spacing.md },
  subtitle: { color: colors.textSecondary, fontSize: 14, marginTop: 6 },
  card: { flexDirection: "row", alignItems: "center", gap: spacing.md, padding: spacing.md, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: "rgba(255,255,255,0.05)" },
  iconWrap: { width: 44, height: 44, borderRadius: 22, backgroundColor: "rgba(212,175,55,0.1)", alignItems: "center", justifyContent: "center" },
  itemLabel: { color: colors.ivory, fontSize: 15, fontWeight: "600" },
  itemDesc: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
});

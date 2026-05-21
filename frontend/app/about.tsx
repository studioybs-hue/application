import { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Linking,
  useWindowDimensions,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert } from "@/src/utils/dialog";

// --- COMPANY INFO (matches creativindustry.com/contact exactly) ---
const COMPANY = {
  name: "CREATIVINDUSTRY France",
  brand: "CINÉMARIÉS",
  brandTagline: "Une marque de CREATIVINDUSTRY France",
  phone: "07 49 20 89 22",
  phoneRaw: "+33749208922",
  email: "contact@creativindustry.com",
  address: "60 rue François 1er",
  city: "75008 Paris",
  hours: ["Lun - Ven : 9h - 19h", "Sam - Dim : sur rendez-vous"],
  website: "https://creativindustry.com",
};

export default function AboutScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const isWide = width >= 900;

  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    subject: "",
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.subject.trim() || !form.message.trim()) {
      showAlert(
        "Champs requis",
        "Merci de renseigner votre nom, email, sujet et message."
      );
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      showAlert("Email invalide", "Merci de saisir une adresse email correcte.");
      return;
    }
    setSubmitting(true);
    try {
      await api("/contact", {
        method: "POST",
        body: { ...form, source: "cinemaries-about" },
      });
      setSent(true);
      setForm({ name: "", email: "", phone: "", subject: "", message: "" });
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Impossible d'envoyer votre demande.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <View style={styles.root}>
      <SafeAreaView style={styles.headerWrap} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.iconBtn} testID="about-back">
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Contact</Text>
          <View style={{ width: 40 }} />
        </View>
      </SafeAreaView>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView
          contentContainerStyle={{ paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
        >
          {/* ===== HERO ===== */}
          <View style={styles.hero}>
            <LinearGradient
              colors={["transparent", "rgba(10,10,10,0.7)", colors.bg]}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <View style={styles.heroContent}>
              <Text style={styles.brand}>{COMPANY.brand}</Text>
              <View style={styles.goldLine} />
              <Text style={styles.brandSub}>{COMPANY.brandTagline}</Text>
            </View>
          </View>

          {/* ===== INTRO ===== */}
          <View style={styles.sectionCentered}>
            <Text style={styles.bigTitle}>Contact</Text>
            <Text style={styles.bigSub}>Une question ? Un projet ? Parlons-en !</Text>
          </View>

          {/* ===== TWO-COLUMN LAYOUT (coordonnées + formulaire) ===== */}
          <View style={[styles.twoCol, isWide && styles.twoColWide]}>
            {/* === COLUMN 1: COORDONNÉES === */}
            <View style={[styles.col, isWide && { flex: 1 }]}>
              <View style={styles.coordCard}>
                <Text style={styles.coordTitle}>Nos coordonnées</Text>

                <TouchableOpacity
                  style={styles.coordRow}
                  onPress={() => Linking.openURL(`tel:${COMPANY.phoneRaw}`)}
                  testID="coord-phone"
                >
                  <View style={styles.coordIconBox}>
                    <Ionicons name="call" size={20} color={colors.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.coordLabel}>Téléphone</Text>
                    <Text style={styles.coordValue}>{COMPANY.phone}</Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity
                  style={styles.coordRow}
                  onPress={() => Linking.openURL(`mailto:${COMPANY.email}`)}
                  testID="coord-email"
                >
                  <View style={styles.coordIconBox}>
                    <Ionicons name="mail" size={20} color={colors.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.coordLabel}>Email</Text>
                    <Text style={styles.coordValue}>{COMPANY.email}</Text>
                  </View>
                </TouchableOpacity>

                <View style={styles.coordRow}>
                  <View style={styles.coordIconBox}>
                    <Ionicons name="location" size={20} color={colors.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.coordLabel}>Adresse</Text>
                    <Text style={styles.coordValue}>{COMPANY.address}</Text>
                    <Text style={styles.coordValue}>{COMPANY.city}</Text>
                  </View>
                </View>

                <View style={styles.coordRow}>
                  <View style={styles.coordIconBox}>
                    <Ionicons name="time" size={20} color={colors.gold} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.coordLabel}>Horaires</Text>
                    {COMPANY.hours.map((h) => (
                      <Text key={h} style={styles.coordValueSmall}>{h}</Text>
                    ))}
                  </View>
                </View>

                <TouchableOpacity
                  style={styles.websiteBtn}
                  onPress={() => Linking.openURL(COMPANY.website)}
                  testID="coord-website"
                >
                  <Ionicons name="globe-outline" size={16} color={colors.gold} />
                  <Text style={styles.websiteTxt}>creativindustry.com</Text>
                  <Ionicons name="arrow-forward" size={14} color={colors.gold} />
                </TouchableOpacity>
              </View>
            </View>

            {/* === COLUMN 2: FORMULAIRE === */}
            <View style={[styles.col, isWide && { flex: 1.2 }]}>
              <View style={styles.formCard}>
                <Text style={styles.coordTitle}>Demande de devis</Text>

                {sent ? (
                  <View style={styles.sentBox}>
                    <Ionicons name="checkmark-circle" size={48} color={colors.gold} />
                    <Text style={styles.sentTitle}>Message envoyé</Text>
                    <Text style={styles.sentText}>
                      Merci pour votre message. Notre équipe vous répondra dans les
                      plus brefs délais.
                    </Text>
                    <TouchableOpacity
                      style={styles.sentBtn}
                      onPress={() => setSent(false)}
                      testID="contact-send-another"
                    >
                      <Text style={styles.sentBtnTxt}>Envoyer un autre message</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={{ gap: 14 }}>
                    <Field
                      label="Nom *"
                      value={form.name}
                      onChange={(v) => set("name", v)}
                      placeholder="Votre nom complet"
                      testID="contact-name"
                    />
                    <Field
                      label="Email *"
                      value={form.email}
                      onChange={(v) => set("email", v)}
                      placeholder="votre@email.com"
                      keyboardType="email-address"
                      autoCapitalize="none"
                      testID="contact-email"
                    />
                    <Field
                      label="Téléphone"
                      value={form.phone}
                      onChange={(v) => set("phone", v)}
                      placeholder="06 12 34 56 78"
                      keyboardType="phone-pad"
                      testID="contact-phone"
                    />
                    <Field
                      label="Sujet *"
                      value={form.subject}
                      onChange={(v) => set("subject", v)}
                      placeholder="Mariage le 15 juin 2026 à Paris"
                      testID="contact-subject"
                    />
                    <Field
                      label="Message *"
                      value={form.message}
                      onChange={(v) => set("message", v)}
                      placeholder="Décrivez votre projet, vos envies, votre budget..."
                      multiline
                      testID="contact-message"
                    />

                    <TouchableOpacity
                      style={[styles.submitBtn, submitting && { opacity: 0.6 }]}
                      onPress={submit}
                      disabled={submitting}
                      testID="contact-submit"
                    >
                      {submitting ? (
                        <ActivityIndicator color="#0A0A0A" />
                      ) : (
                        <>
                          <Text style={styles.submitTxt}>Envoyer le message</Text>
                          <Ionicons name="arrow-forward" size={18} color="#0A0A0A" />
                        </>
                      )}
                    </TouchableOpacity>

                    <Text style={styles.rgpd}>
                      En envoyant ce formulaire, vous acceptez que vos données soient
                      utilisées pour répondre à votre demande. Aucune donnée n'est
                      partagée avec des tiers.
                    </Text>
                  </View>
                )}
              </View>
            </View>
          </View>

          {/* ===== ABOUT CINÉMARIÉS ===== */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>À propos de CINÉMARIÉS</Text>
            <Text style={styles.bodyText}>
              CINÉMARIÉS est l'application dédiée aux mariages produits par
              CREATIVINDUSTRY France. Chaque couple bénéficie d'un espace privé où
              retrouver ses bandes-annonces, son film complet et le partager en toute
              simplicité — depuis n'importe quel appareil, sur grand écran via
              Chromecast, à vie.
            </Text>
          </View>

          {/* ===== SERVICES MARIAGE ===== */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Nos prestations mariage</Text>

            <View style={styles.serviceCard}>
              <Ionicons name="film-outline" size={28} color={colors.gold} />
              <View style={styles.serviceText}>
                <Text style={styles.serviceTitle}>Film de mariage cinématique</Text>
                <Text style={styles.serviceDesc}>
                  Captation cérémonie, soirée, photos de couple. Montage cinéma avec
                  bande-annonce + film complet.
                </Text>
              </View>
            </View>

            <View style={styles.serviceCard}>
              <Ionicons name="videocam-outline" size={28} color={colors.gold} />
              <View style={styles.serviceText}>
                <Text style={styles.serviceTitle}>Bande-annonce sur-mesure</Text>
                <Text style={styles.serviceDesc}>
                  Un teaser de 2-3 min à partager sur vos réseaux dès le lendemain du
                  mariage.
                </Text>
              </View>
            </View>

            <View style={styles.serviceCard}>
              <Ionicons name="cloud-outline" size={28} color={colors.gold} />
              <View style={styles.serviceText}>
                <Text style={styles.serviceTitle}>Hébergement à vie — 90€</Text>
                <Text style={styles.serviceDesc}>
                  Votre film hébergé sur notre plateforme privée pour toujours. Code
                  unique pour vos invités, diffusion Chromecast, qualité Full HD.
                </Text>
              </View>
            </View>

            <View style={styles.serviceCard}>
              <Ionicons name="tv-outline" size={28} color={colors.gold} />
              <View style={styles.serviceText}>
                <Text style={styles.serviceTitle}>Diffusion Chromecast</Text>
                <Text style={styles.serviceDesc}>
                  Regardez votre film sur votre TV depuis l'application, sans
                  installation supplémentaire.
                </Text>
              </View>
            </View>
          </View>

          {/* ===== FOOTER ===== */}
          <View style={styles.footer}>
            <Text style={styles.footerBrand}>{COMPANY.brand}</Text>
            <Text style={styles.footerSub}>une marque de</Text>
            <TouchableOpacity onPress={() => Linking.openURL(COMPANY.website)}>
              <Text style={styles.footerParent}>{COMPANY.name}</Text>
            </TouchableOpacity>
            <Text style={styles.footerCopyright}>
              © {new Date().getFullYear()} — Tous droits réservés
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  multiline,
  keyboardType,
  autoCapitalize,
  testID,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  keyboardType?: any;
  autoCapitalize?: any;
  testID?: string;
}) {
  return (
    <View>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && styles.inputMulti]}
        value={value}
        onChangeText={onChange}
        placeholder={placeholder}
        placeholderTextColor={colors.textDisabled}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        testID={testID}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  headerWrap: { backgroundColor: colors.bg, zIndex: 10 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  iconBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: { color: colors.ivory, fontSize: 16, fontWeight: "700", letterSpacing: 1 },

  hero: {
    height: 200,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  heroContent: { alignItems: "center", padding: spacing.lg, zIndex: 2 },
  brand: {
    color: colors.gold,
    fontSize: 30,
    fontWeight: "900",
    letterSpacing: 4,
    textAlign: "center",
  },
  goldLine: {
    width: 60,
    height: 2,
    backgroundColor: colors.gold,
    marginVertical: spacing.sm,
  },
  brandSub: {
    color: colors.ivory,
    fontSize: 12,
    fontStyle: "italic",
    textAlign: "center",
    letterSpacing: 1,
    opacity: 0.8,
  },

  sectionCentered: { paddingHorizontal: spacing.md, paddingTop: spacing.xl, alignItems: "center" },
  bigTitle: {
    color: colors.ivory,
    fontSize: 32,
    fontWeight: "800",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  bigSub: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 8,
    textAlign: "center",
  },

  twoCol: { paddingHorizontal: spacing.md, paddingTop: spacing.xl, gap: spacing.md },
  twoColWide: { flexDirection: "row", alignItems: "flex-start" },
  col: { flex: 1, minWidth: 0 },

  coordCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  coordTitle: {
    color: colors.gold,
    fontSize: 20,
    fontWeight: "800",
    marginBottom: spacing.md,
    letterSpacing: 0.5,
  },
  coordRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
    gap: 14,
  },
  coordIconBox: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(212,175,55,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  coordLabel: { color: colors.textSecondary, fontSize: 11, letterSpacing: 1, fontWeight: "600" },
  coordValue: { color: colors.ivory, fontSize: 14, fontWeight: "600", marginTop: 2 },
  coordValueSmall: { color: colors.ivory, fontSize: 12, marginTop: 2 },

  websiteBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  websiteTxt: { color: colors.gold, fontWeight: "700", fontSize: 13 },

  formCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },

  fieldLabel: {
    color: colors.ivory,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  input: {
    backgroundColor: "rgba(0,0,0,0.4)",
    color: colors.ivory,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 14,
  },
  inputMulti: { minHeight: 120, textAlignVertical: "top", paddingTop: 12 },

  submitBtn: {
    backgroundColor: colors.gold,
    paddingVertical: 14,
    borderRadius: radii.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    marginTop: spacing.sm,
  },
  submitTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 14, letterSpacing: 0.5 },

  rgpd: {
    color: colors.textDisabled,
    fontSize: 10,
    lineHeight: 16,
    marginTop: 8,
    textAlign: "center",
    fontStyle: "italic",
  },

  sentBox: {
    alignItems: "center",
    paddingVertical: spacing.md,
  },
  sentTitle: {
    color: colors.gold,
    fontSize: 20,
    fontWeight: "800",
    marginTop: spacing.sm,
  },
  sentText: {
    color: colors.ivory,
    fontSize: 13,
    textAlign: "center",
    marginTop: 6,
    lineHeight: 20,
    paddingHorizontal: spacing.sm,
  },
  sentBtn: {
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: colors.gold,
  },
  sentBtnTxt: { color: colors.gold, fontWeight: "700", fontSize: 13 },

  section: { paddingHorizontal: spacing.md, paddingTop: spacing.xl },
  sectionTitle: {
    color: colors.ivory,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: spacing.sm,
    letterSpacing: 0.5,
  },
  bodyText: { color: colors.textSecondary, fontSize: 14, lineHeight: 22 },

  serviceCard: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.md,
    alignItems: "flex-start",
  },
  serviceText: { flex: 1 },
  serviceTitle: { color: colors.ivory, fontSize: 15, fontWeight: "700", marginBottom: 4 },
  serviceDesc: { color: colors.textSecondary, fontSize: 12, lineHeight: 18 },

  footer: {
    alignItems: "center",
    marginTop: spacing.xl,
    paddingTop: spacing.lg,
    paddingHorizontal: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerBrand: {
    color: colors.gold,
    fontSize: 18,
    fontWeight: "900",
    letterSpacing: 3,
  },
  footerSub: {
    color: colors.textDisabled,
    fontSize: 11,
    marginTop: 4,
    fontStyle: "italic",
  },
  footerParent: {
    color: colors.ivory,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1,
    marginTop: 2,
    textDecorationLine: "underline",
  },
  footerCopyright: {
    color: colors.textDisabled,
    fontSize: 11,
    marginTop: spacing.sm,
  },
});

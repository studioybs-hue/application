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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert } from "@/src/utils/dialog";

export default function AboutScreen() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    wedding_date: "",
    location: "",
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const submit = async () => {
    if (!form.name.trim() || !form.email.trim() || !form.message.trim()) {
      showAlert("Champs requis", "Merci de renseigner votre nom, email et un petit message.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      showAlert("Email invalide", "Merci de saisir une adresse email correcte.");
      return;
    }
    setSubmitting(true);
    try {
      await api("/contact", { method: "POST", body: { ...form, source: "about" } });
      setSent(true);
      setForm({ name: "", email: "", phone: "", wedding_date: "", location: "", message: "" });
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
          <Text style={styles.headerTitle}>À propos</Text>
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
              <Text style={styles.brand}>CINÉMARIÉS</Text>
              <View style={styles.goldLine} />
              <Text style={styles.tagline}>Vos plus beaux mariages, comme au cinéma</Text>
            </View>
          </View>

          {/* ===== STORY / MISSION ===== */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notre vision</Text>
            <Text style={styles.bodyText}>
              CINÉMARIÉS est un studio vidéo de mariage haut de gamme, dédié à transformer
              le jour le plus important de votre vie en une véritable expérience
              cinématographique.{"\n\n"}
              Plus qu'un simple film de mariage, nous créons des histoires : des émotions
              authentiques, des images soignées, une narration immersive. Comme au cinéma,
              chaque détail compte — du choix des plans aux musiques sélectionnées.
            </Text>
          </View>

          {/* ===== SERVICES ===== */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Nos services</Text>

            <View style={styles.serviceCard}>
              <Ionicons name="film-outline" size={28} color={colors.gold} />
              <View style={styles.serviceText}>
                <Text style={styles.serviceTitle}>Film de mariage complet</Text>
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
                  Regardez votre film sur votre TV depuis l'application, sans installation.
                </Text>
              </View>
            </View>
          </View>

          {/* ===== WHY US ===== */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Pourquoi CINÉMARIÉS ?</Text>
            <View style={styles.bulletRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.gold} />
              <Text style={styles.bulletText}>Studio professionnel basé en France</Text>
            </View>
            <View style={styles.bulletRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.gold} />
              <Text style={styles.bulletText}>
                Plateforme privée et sécurisée pour vos vidéos (1 code = 1 mariage)
              </Text>
            </View>
            <View style={styles.bulletRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.gold} />
              <Text style={styles.bulletText}>
                Qualité cinéma : caméras 4K, stabilisateurs, lumières professionnelles
              </Text>
            </View>
            <View style={styles.bulletRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.gold} />
              <Text style={styles.bulletText}>
                Hébergement à vie inclus — votre film ne disparaît jamais
              </Text>
            </View>
            <View style={styles.bulletRow}>
              <Ionicons name="checkmark-circle" size={20} color={colors.gold} />
              <Text style={styles.bulletText}>
                Partage facile avec famille & amis via Chromecast
              </Text>
            </View>
          </View>

          {/* ===== CONTACT FORM ===== */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Demande de devis</Text>
            <Text style={styles.sectionSub}>
              Parlez-nous de votre projet, nous revenons vers vous sous 24h.
            </Text>

            {sent ? (
              <View style={styles.sentBox}>
                <Ionicons name="checkmark-circle" size={48} color={colors.gold} />
                <Text style={styles.sentTitle}>Merci !</Text>
                <Text style={styles.sentText}>
                  Votre demande a bien été envoyée. Nous vous répondrons dans les plus
                  brefs délais.
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
              <View style={{ gap: 12 }}>
                <Field
                  label="Votre nom *"
                  value={form.name}
                  onChange={(v) => set("name", v)}
                  placeholder="Camille & Antoine"
                  testID="contact-name"
                />
                <Field
                  label="Email *"
                  value={form.email}
                  onChange={(v) => set("email", v)}
                  placeholder="camille@email.com"
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
                  label="Date du mariage (si connue)"
                  value={form.wedding_date}
                  onChange={(v) => set("wedding_date", v)}
                  placeholder="15 juin 2026"
                  testID="contact-date"
                />
                <Field
                  label="Lieu du mariage"
                  value={form.location}
                  onChange={(v) => set("location", v)}
                  placeholder="Paris, Lyon..."
                  testID="contact-location"
                />
                <Field
                  label="Votre message *"
                  value={form.message}
                  onChange={(v) => set("message", v)}
                  placeholder="Parlez-nous de votre projet, vos envies, votre budget..."
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
                      <Ionicons name="paper-plane" size={18} color="#0A0A0A" />
                      <Text style={styles.submitTxt}>Envoyer ma demande</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </View>

          {/* ===== DIRECT CONTACT ===== */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Contact direct</Text>
            <TouchableOpacity
              style={styles.contactRow}
              onPress={() => Linking.openURL("mailto:contact@cinemaries.fr")}
              testID="contact-email-link"
            >
              <Ionicons name="mail-outline" size={22} color={colors.gold} />
              <Text style={styles.contactTxt}>contact@cinemaries.fr</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.contactRow}
              onPress={() => Linking.openURL("https://cinemaries.fr")}
              testID="contact-website-link"
            >
              <Ionicons name="globe-outline" size={22} color={colors.gold} />
              <Text style={styles.contactTxt}>cinemaries.fr</Text>
            </TouchableOpacity>
          </View>

          {/* ===== FOOTER ===== */}
          <View style={styles.footer}>
            <Text style={styles.footerBrand}>CINÉMARIÉS</Text>
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
    height: 240,
    backgroundColor: "#1a1a1a",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  heroContent: { alignItems: "center", padding: spacing.lg, zIndex: 2 },
  brand: {
    color: colors.gold,
    fontSize: 32,
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
  tagline: {
    color: colors.ivory,
    fontSize: 14,
    fontStyle: "italic",
    textAlign: "center",
    letterSpacing: 1,
  },

  section: { paddingHorizontal: spacing.md, paddingTop: spacing.xl },
  sectionTitle: {
    color: colors.ivory,
    fontSize: 22,
    fontWeight: "800",
    marginBottom: spacing.sm,
    letterSpacing: 0.5,
  },
  sectionSub: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.md },
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

  bulletRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 10,
    paddingVertical: 6,
  },
  bulletText: { color: colors.ivory, fontSize: 13, flex: 1, lineHeight: 20 },

  fieldLabel: {
    color: colors.ivory,
    fontSize: 12,
    fontWeight: "600",
    marginBottom: 6,
    letterSpacing: 0.3,
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.ivory,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: colors.border,
    fontSize: 14,
  },
  inputMulti: { minHeight: 100, textAlignVertical: "top", paddingTop: 12 },

  submitBtn: {
    backgroundColor: colors.gold,
    paddingVertical: 14,
    borderRadius: radii.sm,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    marginTop: spacing.sm,
  },
  submitTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 14, letterSpacing: 0.5 },

  sentBox: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.gold,
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

  contactRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  contactTxt: { color: colors.ivory, fontSize: 14 },

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
    fontSize: 16,
    fontWeight: "900",
    letterSpacing: 3,
  },
  footerCopyright: {
    color: colors.textDisabled,
    fontSize: 11,
    marginTop: 4,
  },
});

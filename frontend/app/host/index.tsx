import { useState, useEffect } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { useAuth } from "@/src/auth/AuthContext";
import { showAlert } from "@/src/utils/dialog";

export default function HostScreen() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const params = useLocalSearchParams<{ status?: string }>();
  const [step, setStep] = useState<"intro" | "form">("intro");

  const [coupleName, setCoupleName] = useState("");
  const [weddingDate, setWeddingDate] = useState("");
  const [location, setLocation] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [description, setDescription] = useState("");
  const [driveLink, setDriveLink] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (user && !contactEmail) setContactEmail(user.email);
  }, [user, contactEmail]);

  useEffect(() => {
    if (params.status === "cancel") {
      showAlert("Paiement annulé", "Vous n'avez pas été débité. Vous pouvez réessayer à tout moment.");
    }
  }, [params.status]);

  const submit = async () => {
    if (!user) {
      router.push("/auth/login?redirect=/host");
      return;
    }
    if (coupleName.trim().length < 2) {
      showAlert("Information manquante", "Veuillez indiquer le nom du couple (ex: « Sarah & Anthony »).");
      return;
    }
    if (!contactEmail.includes("@")) {
      showAlert("Email invalide", "Veuillez indiquer un email valide pour la suite des échanges.");
      return;
    }
    setSubmitting(true);
    try {
      const r = await api<{ checkout_url: string; id: string }>("/hosting/requests", {
        method: "POST",
        body: {
          couple_name: coupleName.trim(),
          wedding_date: weddingDate.trim() || null,
          location: location.trim(),
          contact_email: contactEmail.trim(),
          contact_phone: contactPhone.trim(),
          description: description.trim(),
          drive_link: driveLink.trim(),
          notes: notes.trim(),
        },
      });
      if (Platform.OS === "web") {
        window.location.href = r.checkout_url;
      } else {
        // For native, use WebBrowser
        const WebBrowser = await import("expo-web-browser");
        await WebBrowser.openBrowserAsync(r.checkout_url);
      }
    } catch (e: any) {
      showAlert("Erreur", e.message || "Impossible de créer votre demande.");
    } finally {
      setSubmitting(false);
    }
  };

  if (authLoading) {
    return <View style={styles.loading}><ActivityIndicator color={colors.gold} /></View>;
  }

  return (
    <View style={styles.root}>
      <LinearGradient colors={[colors.burgundy, colors.bg]} style={StyleSheet.absoluteFillObject} />
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} style={styles.back} testID="host-back">
            <Ionicons name="close" size={28} color={colors.ivory} />
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
            {step === "intro" ? (
              <>
                <View style={styles.iconBubble}>
                  <Ionicons name="heart" size={36} color={colors.gold} />
                </View>
                <Text style={styles.title}>Hébergez votre mariage</Text>
                <Text style={styles.subtitle}>Votre plus beau jour, archivé pour la vie sur CINÉMARIÉS.</Text>

                <View style={styles.priceCard}>
                  <Text style={styles.priceLabel}>Frais d'hébergement à vie</Text>
                  <Text style={styles.priceBig}>90€</Text>
                  <Text style={styles.priceNote}>Paiement unique — aucun renouvellement</Text>
                </View>

                <View style={styles.steps}>
                  <Step n="1" title="Vous remplissez le formulaire" sub="2 minutes — infos du couple, contact, lien des vidéos brutes." />
                  <Step n="2" title="Paiement sécurisé 90€" sub="Stripe — par CB, ApplePay ou GooglePay." />
                  <Step n="3" title="Notre équipe monte votre film" sub="Sous 7 jours ouvrés à partir de la réception des vidéos." />
                  <Step n="4" title="Votre mariage est en ligne" sub="Choisissez ensuite votre abonnement pour inviter vos proches (1,99€ ou 2,30€/mois)." />
                </View>

                <View style={styles.benefits}>
                  <Benefit icon="cloud" text="Hébergement sécurisé à vie" />
                  <Benefit icon="lock-closed" text="Vos vidéos restent 100% privées" />
                  <Benefit icon="key" text="Codes d'accès personnalisés pour chaque invité" />
                  <Benefit icon="tv" text="Compatible Chromecast & Smart TV" />
                </View>

                <TouchableOpacity style={styles.cta} onPress={() => setStep("form")} testID="host-start-btn">
                  <Text style={styles.ctaTxt}>Commencer ma demande</Text>
                  <Ionicons name="arrow-forward" size={18} color="#0A0A0A" />
                </TouchableOpacity>

                <Text style={styles.fine}>
                  Aucun débit avant validation du formulaire.{"\n"}
                  Vous serez redirigé vers Stripe pour le paiement sécurisé.
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.title}>Votre demande</Text>
                <Text style={styles.subtitle}>Quelques infos pour préparer votre espace.</Text>

                <Field label="Nom du couple *" value={coupleName} onChangeText={setCoupleName} placeholder="Ex : Sarah & Anthony" />
                <Field label="Date du mariage" value={weddingDate} onChangeText={setWeddingDate} placeholder="JJ/MM/AAAA" />
                <Field label="Lieu / Ville" value={location} onChangeText={setLocation} placeholder="Paris, Marseille…" />
                <Field label="Email de contact *" value={contactEmail} onChangeText={setContactEmail} placeholder="vous@email.com" keyboardType="email-address" />
                <Field label="Téléphone (recommandé)" value={contactPhone} onChangeText={setContactPhone} placeholder="06 12 34 56 78" keyboardType="phone-pad" />
                <Field
                  label="Petite histoire / description"
                  value={description}
                  onChangeText={setDescription}
                  placeholder="Quelques mots sur votre journée (visible sur la page du mariage)…"
                  multiline
                />
                <Field
                  label="Lien Drive / WeTransfer des vidéos brutes"
                  value={driveLink}
                  onChangeText={setDriveLink}
                  placeholder="https://drive.google.com/…"
                />
                <Field
                  label="Notes pour l'équipe"
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Souhaits particuliers, scènes à mettre en valeur…"
                  multiline
                />

                <TouchableOpacity style={styles.cta} onPress={submit} disabled={submitting} testID="host-pay-btn">
                  {submitting ? (
                    <ActivityIndicator color="#0A0A0A" />
                  ) : (
                    <>
                      <Ionicons name="card" size={18} color="#0A0A0A" />
                      <Text style={styles.ctaTxt}>Payer 90€ et envoyer ma demande</Text>
                    </>
                  )}
                </TouchableOpacity>

                <TouchableOpacity onPress={() => setStep("intro")} style={styles.secondaryBtn}>
                  <Text style={styles.secondaryTxt}>Retour</Text>
                </TouchableOpacity>
              </>
            )}
            <View style={{ height: 40 }} />
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </View>
  );
}

function Step({ n, title, sub }: { n: string; title: string; sub: string }) {
  return (
    <View style={styles.step}>
      <View style={styles.stepCircle}><Text style={styles.stepN}>{n}</Text></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepSub}>{sub}</Text>
      </View>
    </View>
  );
}

function Benefit({ icon, text }: { icon: any; text: string }) {
  return (
    <View style={styles.benefit}>
      <Ionicons name={icon} size={16} color={colors.gold} />
      <Text style={styles.benefitTxt}>{text}</Text>
    </View>
  );
}

function Field({
  label, value, onChangeText, placeholder, keyboardType, multiline,
}: {
  label: string; value: string; onChangeText: (s: string) => void;
  placeholder?: string; keyboardType?: any; multiline?: boolean;
}) {
  return (
    <View style={{ marginBottom: 14 }}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, multiline && { height: 90, textAlignVertical: "top", paddingTop: 12 }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textDisabled}
        keyboardType={keyboardType}
        multiline={multiline}
        autoCapitalize="sentences"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: colors.bg },
  header: { flexDirection: "row", justifyContent: "flex-end" },
  back: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  scroll: { padding: spacing.md, paddingBottom: spacing.xl },
  iconBubble: { width: 88, height: 88, borderRadius: 44, backgroundColor: "rgba(212,175,55,0.1)", borderWidth: 1.5, borderColor: colors.gold, alignSelf: "center", alignItems: "center", justifyContent: "center", marginBottom: spacing.md },
  title: { color: colors.ivory, fontSize: 28, fontWeight: "700", textAlign: "center" },
  subtitle: { color: colors.textSecondary, fontSize: 14, textAlign: "center", marginTop: 8, marginBottom: spacing.lg },
  priceCard: { backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.gold, borderRadius: radii.lg, padding: spacing.lg, alignItems: "center", marginBottom: spacing.lg },
  priceLabel: { color: colors.textSecondary, fontSize: 12, letterSpacing: 1, textTransform: "uppercase" },
  priceBig: { color: colors.gold, fontSize: 56, fontWeight: "800", marginTop: 4, letterSpacing: -2 },
  priceNote: { color: colors.ivory, fontSize: 13, marginTop: 4, fontStyle: "italic" },
  steps: { gap: 14, marginBottom: spacing.lg },
  step: { flexDirection: "row", gap: 12, alignItems: "flex-start" },
  stepCircle: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center" },
  stepN: { color: "#0A0A0A", fontWeight: "800" },
  stepTitle: { color: colors.ivory, fontSize: 15, fontWeight: "700" },
  stepSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2, lineHeight: 18 },
  benefits: { marginBottom: spacing.lg },
  benefit: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 6 },
  benefitTxt: { color: colors.ivory, fontSize: 13 },
  cta: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.gold, paddingVertical: 16, borderRadius: radii.sm },
  ctaTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 16 },
  fine: { color: colors.textDisabled, fontSize: 11, textAlign: "center", marginTop: spacing.md, lineHeight: 16, fontStyle: "italic" },
  secondaryBtn: { alignSelf: "center", paddingVertical: 12, marginTop: 8 },
  secondaryTxt: { color: colors.textSecondary, textDecorationLine: "underline" },
  label: { color: colors.textSecondary, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
  input: { backgroundColor: colors.surface, color: colors.ivory, padding: 14, borderRadius: 8, fontSize: 14, borderWidth: 1, borderColor: colors.border },
});

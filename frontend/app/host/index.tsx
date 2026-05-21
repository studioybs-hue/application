import { useState, useEffect, useRef } from "react";
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
  const [deliveryMethod, setDeliveryMethod] = useState<"upload_link" | "external_link" | "usb_office">("upload_link");

  const [submitting, setSubmitting] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const scrollRef = useRef<ScrollView>(null);

  // Pre-fill contact email with the logged-in user's email
  useEffect(() => {
    if (user && !contactEmail) setContactEmail(user.email);
  }, [user, contactEmail]);

  // Auto-scroll to top when switching to the form
  useEffect(() => {
    if (step === "form" && scrollRef.current) {
      setTimeout(() => scrollRef.current?.scrollTo({ y: 0, animated: true }), 50);
    }
  }, [step]);

  useEffect(() => {
    if (params.status === "cancel") {
      showAlert("Paiement annulé", "Vous n'avez pas été débité. Vous pouvez réessayer à tout moment.");
    }
  }, [params.status]);

  // Auth gate: ensure user is logged in BEFORE filling the form (avoid losing data at submit time)
  const goToForm = () => {
    if (!user) {
      router.push({
        pathname: "/auth/register",
        params: { redirect: "/host" },
      } as any);
      return;
    }
    setStep("form");
  };

  const submit = async () => {
    if (!user) {
      router.push({
        pathname: "/auth/register",
        params: { redirect: "/host" },
      } as any);
      return;
    }
    if (coupleName.trim().length < 2) {
      // Auto-scroll back to top so user sees the missing field
      scrollRef.current?.scrollTo({ y: 0, animated: true });
      showAlert("Information manquante", "Veuillez indiquer le nom du couple en haut du formulaire (ex: « Sarah & Anthony »).");
      return;
    }
    if (!contactEmail.includes("@") || !contactEmail.includes(".")) {
      showAlert("Email invalide", "Veuillez saisir un email valide (ex: vous@email.com) pour qu'on puisse vous recontacter.");
      return;
    }
    if (!acceptedTerms) {
      showAlert(
        "Acceptation requise",
        "Vous devez accepter les CGV, CGU et la Politique de confidentialité pour procéder au paiement de 90€."
      );
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
          drive_link: deliveryMethod === "external_link" ? driveLink.trim() : "",
          notes: notes.trim(),
          delivery_method: deliveryMethod,
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
          <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
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

                <TouchableOpacity style={styles.cta} onPress={goToForm} testID="host-start-btn">
                  <Text style={styles.ctaTxt}>{user ? "Commencer ma demande" : "Créer mon compte et commencer"}</Text>
                  <Ionicons name="arrow-forward" size={18} color="#0A0A0A" />
                </TouchableOpacity>

                <Text style={styles.fine}>
                  {user
                    ? "Aucun débit avant validation du formulaire.\nVous serez redirigé vers Stripe pour le paiement sécurisé."
                    : "Vous serez d'abord invité à créer votre compte (gratuit), puis vous remplirez les infos de votre mariage, et enfin paiement sécurisé via Stripe."}
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.title}>Votre demande</Text>
                <Text style={styles.subtitle}>Quelques infos pour préparer votre espace.</Text>

                {/* Highlighted required field at the top */}
                <View style={styles.requiredCard}>
                  <View style={styles.requiredHeader}>
                    <View style={styles.requiredBadge}><Text style={styles.requiredBadgeTxt}>OBLIGATOIRE</Text></View>
                    <Ionicons name="heart" size={18} color={colors.gold} />
                  </View>
                  <Text style={styles.requiredLabel}>Nom du couple</Text>
                  <Text style={styles.requiredHint}>Ce nom apparaîtra sur la page de votre mariage</Text>
                  <TextInput
                    style={styles.requiredInput}
                    value={coupleName}
                    onChangeText={setCoupleName}
                    placeholder="Ex : Sarah & Anthony"
                    placeholderTextColor={colors.textDisabled}
                    autoCapitalize="words"
                    autoFocus
                  />
                </View>

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

                {/* DELIVERY METHOD SELECTOR */}
                <View style={{ marginBottom: 14 }}>
                  <Text style={styles.label}>Comment livrer vos vidéos brutes ? *</Text>

                  <DeliveryOption
                    selected={deliveryMethod === "upload_link"}
                    onPress={() => setDeliveryMethod("upload_link")}
                    icon="cloud-upload"
                    badge="RECOMMANDÉ"
                    title="Lien d'upload sécurisé"
                    subtitle="On vous génère automatiquement un lien chiffré pour déposer vos fichiers (jusqu'à 50 Go, multi-fichiers)"
                  />

                  <DeliveryOption
                    selected={deliveryMethod === "external_link"}
                    onPress={() => setDeliveryMethod("external_link")}
                    icon="link"
                    title="WeTransfer / Google Drive"
                    subtitle="Vous nous envoyez votre propre lien de transfert"
                  />

                  <DeliveryOption
                    selected={deliveryMethod === "usb_office"}
                    onPress={() => setDeliveryMethod("usb_office")}
                    icon="business"
                    title="Dépôt clé USB au bureau"
                    subtitle="36 rue du Génie, 13003 Marseille — sur rdv uniquement"
                  />

                  {deliveryMethod === "external_link" && (
                    <View style={{ marginTop: 10 }}>
                      <Text style={styles.label}>Collez votre lien ici</Text>
                      <TextInput
                        style={styles.input}
                        value={driveLink}
                        onChangeText={setDriveLink}
                        placeholder="https://wetransfer.com/… ou https://drive.google.com/…"
                        placeholderTextColor={colors.textDisabled}
                        autoCapitalize="none"
                      />
                    </View>
                  )}

                  {deliveryMethod === "upload_link" && (
                    <View style={styles.infoCard}>
                      <Ionicons name="information-circle" size={16} color={colors.gold} />
                      <Text style={styles.infoTxt}>
                        Après paiement, vous recevrez un lien sécurisé personnel à partager avec votre vidéaste pour déposer les fichiers.
                      </Text>
                    </View>
                  )}

                  {deliveryMethod === "usb_office" && (
                    <View style={styles.infoCard}>
                      <Ionicons name="location" size={16} color={colors.gold} />
                      <Text style={styles.infoTxt}>
                        <Text style={{ fontWeight: "700", color: colors.ivory }}>CREATIVINDUSTRY FRANCE{"\n"}</Text>
                        36 rue du Génie{"\n"}
                        13003 Marseille{"\n\n"}
                        <Text style={{ fontStyle: "italic" }}>Sur rdv uniquement</Text> — nous vous contacterons après paiement pour fixer un rendez-vous.
                      </Text>
                    </View>
                  )}
                </View>

                <Field
                  label="Notes pour l'équipe"
                  value={notes}
                  onChangeText={setNotes}
                  placeholder="Souhaits particuliers, scènes à mettre en valeur…"
                  multiline
                />

                <TouchableOpacity
                  style={styles.consentRow}
                  onPress={() => setAcceptedTerms(!acceptedTerms)}
                  activeOpacity={0.7}
                  testID="host-consent-checkbox"
                >
                  <View style={[styles.checkbox, acceptedTerms && styles.checkboxChecked]}>
                    {acceptedTerms ? <Ionicons name="checkmark" size={14} color="#0A0A0A" /> : null}
                  </View>
                  <Text style={styles.consentTxt}>
                    J'accepte les{" "}
                    <Text style={styles.consentLink} onPress={() => router.push("/legal/cgv")}>CGV</Text>
                    ,{" "}
                    <Text style={styles.consentLink} onPress={() => router.push("/legal/cgu")}>CGU</Text>
                    {" "}et la{" "}
                    <Text style={styles.consentLink} onPress={() => router.push("/legal/privacy")}>Politique de confidentialité</Text>
                    . Je demande le démarrage immédiat du service et renonce expressément à mon droit de rétractation.
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity style={[styles.cta, !acceptedTerms && { opacity: 0.5 }]} onPress={submit} disabled={submitting || !acceptedTerms} testID="host-pay-btn">
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

function DeliveryOption({
  selected, onPress, icon, title, subtitle, badge,
}: {
  selected: boolean; onPress: () => void; icon: any;
  title: string; subtitle: string; badge?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.deliveryCard, selected && styles.deliveryCardActive]}
      onPress={onPress}
      activeOpacity={0.85}
    >
      <View style={[styles.deliveryRadio, selected && styles.deliveryRadioActive]}>
        {selected && <View style={styles.deliveryRadioDot} />}
      </View>
      <Ionicons name={icon} size={22} color={selected ? colors.gold : colors.textSecondary} />
      <View style={{ flex: 1 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Text style={[styles.deliveryTitle, selected && { color: colors.gold }]}>{title}</Text>
          {badge && <View style={styles.deliveryBadge}><Text style={styles.deliveryBadgeTxt}>{badge}</Text></View>}
        </View>
        <Text style={styles.deliverySub}>{subtitle}</Text>
      </View>
    </TouchableOpacity>
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
  consentRow: { flexDirection: "row", alignItems: "flex-start", marginVertical: spacing.md, gap: 10, paddingHorizontal: 4 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center", backgroundColor: colors.surface, marginTop: 2 },
  checkboxChecked: { backgroundColor: colors.gold, borderColor: colors.gold },
  consentTxt: { color: colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 17 },
  consentLink: { color: colors.gold, textDecorationLine: "underline", fontWeight: "600" },
  fine: { color: colors.textDisabled, fontSize: 11, textAlign: "center", marginTop: spacing.md, lineHeight: 16, fontStyle: "italic" },
  secondaryBtn: { alignSelf: "center", paddingVertical: 12, marginTop: 8 },
  secondaryTxt: { color: colors.textSecondary, textDecorationLine: "underline" },
  label: { color: colors.textSecondary, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 },
  input: { backgroundColor: colors.surface, color: colors.ivory, padding: 14, borderRadius: 8, fontSize: 14, borderWidth: 1, borderColor: colors.border },
  requiredCard: {
    backgroundColor: "rgba(212,175,55,0.08)",
    borderWidth: 2,
    borderColor: colors.gold,
    borderRadius: radii.lg,
    padding: spacing.md,
    marginBottom: spacing.lg,
  },
  requiredHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  requiredBadge: { backgroundColor: colors.gold, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4 },
  requiredBadgeTxt: { color: "#0A0A0A", fontSize: 9, fontWeight: "800", letterSpacing: 1.5 },
  requiredLabel: { color: colors.ivory, fontSize: 18, fontWeight: "700", marginTop: 4 },
  requiredHint: { color: colors.textSecondary, fontSize: 12, marginTop: 4, marginBottom: 10, fontStyle: "italic" },
  requiredInput: {
    backgroundColor: colors.bg,
    color: colors.ivory,
    padding: 16,
    borderRadius: 8,
    fontSize: 18,
    fontWeight: "600",
    borderWidth: 1,
    borderColor: colors.gold,
  },
  deliveryCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: radii.md,
    padding: 12,
    marginBottom: 8,
  },
  deliveryCardActive: { borderColor: colors.gold, backgroundColor: "rgba(212,175,55,0.06)" },
  deliveryRadio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  deliveryRadioActive: { borderColor: colors.gold },
  deliveryRadioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.gold },
  deliveryTitle: { color: colors.ivory, fontSize: 14, fontWeight: "700" },
  deliverySub: { color: colors.textSecondary, fontSize: 11, marginTop: 2, lineHeight: 15 },
  deliveryBadge: { backgroundColor: colors.gold, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 3 },
  deliveryBadgeTxt: { color: "#0A0A0A", fontSize: 8, fontWeight: "800", letterSpacing: 0.8 },
  infoCard: { flexDirection: "row", alignItems: "flex-start", gap: 8, backgroundColor: "rgba(212,175,55,0.08)", borderWidth: 1, borderColor: colors.gold, borderRadius: 8, padding: 12, marginTop: 8 },
  infoTxt: { color: colors.textSecondary, fontSize: 12, flex: 1, lineHeight: 18 },
});

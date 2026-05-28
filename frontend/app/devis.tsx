/**
 * Devis Mariage — 3-step wedding quote form (public, no auth required).
 * Mirrors the form at creativindustry.com/devis-mariage:
 *   Step 1: Options — multi-select chips grouped by Couverture / Options / Livrables
 *   Step 2: Date — wedding date + location + guests count + ceremony types
 *   Step 3: Coordonnées — contact info + RGPD consent + submit
 */
import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { showAlert } from "@/src/utils/dialog";
import { colors, spacing, radii } from "@/src/theme";

type CatalogItem = { id: string; label: string; price: number };
type Catalog = { couverture: CatalogItem[]; options: CatalogItem[]; livrables: CatalogItem[] };

const CEREMONY_TYPES = ["Civile", "Religieuse", "Laïque", "Traditionnelle"];
const SOURCES = ["Instagram", "Google", "Recommandation", "TikTok", "Mariages.net", "Autre"];

export default function DevisScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [search, setSearch] = useState("");

  // Step 1
  const [coverageSel, setCoverageSel] = useState<Set<string>>(new Set());
  const [optionsSel, setOptionsSel] = useState<Set<string>>(new Set());
  const [livrablesSel, setLivrablesSel] = useState<Set<string>>(new Set());

  // Step 2
  const [weddingDate, setWeddingDate] = useState("");
  const [location, setLocation] = useState("");
  const [guestsCount, setGuestsCount] = useState("");
  const [ceremonySel, setCeremonySel] = useState<Set<string>>(new Set());

  // Step 3
  const [contactName, setContactName] = useState(user?.full_name || "");
  const [partnerName, setPartnerName] = useState("");
  const [email, setEmail] = useState(user?.email || "");
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState("");
  const [customMessage, setCustomMessage] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const r = await api<{ catalog: Catalog }>("/devis/catalog");
        setCatalog(r.catalog);
      } catch {
        showAlert("Erreur", "Impossible de charger les prestations.");
      }
    })();
  }, []);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    setter(next);
  };

  const matchSearch = (label: string) => {
    if (!search.trim()) return true;
    return label.toLowerCase().includes(search.trim().toLowerCase());
  };

  const totalSelected = coverageSel.size + optionsSel.size + livrablesSel.size;

  const validateStep1 = () => {
    if (totalSelected === 0) {
      showAlert("Sélection requise", "Choisissez au moins une prestation pour continuer.");
      return false;
    }
    return true;
  };

  const validateStep2 = () => {
    if (!weddingDate.trim()) {
      showAlert("Date requise", "Veuillez indiquer la date prévue de votre mariage.");
      return false;
    }
    return true;
  };

  const submit = async () => {
    if (!contactName.trim() || !email.trim() || !phone.trim()) {
      showAlert("Informations manquantes", "Nom, email et téléphone sont obligatoires.");
      return;
    }
    if (!acceptedTerms) {
      showAlert("Consentement requis", "Vous devez accepter le traitement de vos données (RGPD) pour envoyer votre demande.");
      return;
    }
    setSubmitting(true);
    try {
      await api("/devis", {
        method: "POST",
        body: {
          wedding_date: weddingDate.trim(),
          location: location.trim(),
          guests_count: guestsCount ? parseInt(guestsCount, 10) : null,
          ceremony_types: Array.from(ceremonySel),
          coverage_items: Array.from(coverageSel),
          options_items: Array.from(optionsSel),
          deliverables_items: Array.from(livrablesSel),
          custom_message: customMessage.trim(),
          contact_name: contactName.trim(),
          partner_name: partnerName.trim(),
          email: email.trim().toLowerCase(),
          phone: phone.trim(),
          source: source.trim(),
          accepted_terms: true,
        },
      });
      setSubmitted(true);
    } catch (e: any) {
      showAlert("Erreur d'envoi", e.message || "Impossible d'envoyer la demande. Merci de réessayer.");
    } finally {
      setSubmitting(false);
    }
  };

  // ============= SUCCESS SCREEN =============
  if (submitted) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ScrollView contentContainerStyle={styles.successScreen}>
          <LinearGradient colors={["rgba(212,175,55,0.18)", "rgba(212,175,55,0)"]} style={styles.successHero}>
            <View style={styles.successIcon}>
              <Ionicons name="checkmark" size={48} color="#0A0A0A" />
            </View>
            <Text style={styles.successTitle}>Demande envoyée !</Text>
            <Text style={styles.successSub}>
              Merci {contactName}, votre demande de devis a bien été transmise à notre équipe.
            </Text>
            <View style={styles.successCard}>
              <Ionicons name="mail" size={18} color={colors.gold} />
              <Text style={styles.successCardTxt}>Un email de confirmation vient de vous être envoyé à <Text style={{ color: colors.gold }}>{email}</Text></Text>
            </View>
            <View style={styles.successCard}>
              <Ionicons name="time" size={18} color={colors.gold} />
              <Text style={styles.successCardTxt}>Réponse personnalisée <Text style={{ color: colors.gold }}>sous 48 heures</Text></Text>
            </View>
            <View style={styles.successCard}>
              <Ionicons name="call" size={18} color={colors.gold} />
              <Text style={styles.successCardTxt}>Urgent ? Appelez-nous au <Text style={{ color: colors.gold }}>07 49 20 89 22</Text></Text>
            </View>
            <TouchableOpacity style={styles.backHomeBtn} onPress={() => router.replace("/")} testID="devis-back-home">
              <Text style={styles.backHomeTxt}>Retour à l'accueil</Text>
            </TouchableOpacity>
          </LinearGradient>
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1 }}>
        {/* HEADER */}
        <View style={styles.header}>
          <TouchableOpacity onPress={() => router.back()} testID="devis-back">
            <Ionicons name="chevron-back" size={26} color={colors.ivory} />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Devis Mariage</Text>
          <View style={{ width: 26 }} />
        </View>

        {/* STEPPER */}
        <View style={styles.stepperWrap}>
          {[1, 2, 3].map((n) => {
            const labels = ["Options", "Date", "Coordonnées"];
            const active = step === n;
            const done = step > n;
            return (
              <View key={n} style={styles.stepperItem}>
                <View style={[styles.stepDot, active && styles.stepDotActive, done && styles.stepDotDone]}>
                  {done ? <Ionicons name="checkmark" size={12} color="#0A0A0A" /> : <Text style={[styles.stepDotTxt, active && { color: "#0A0A0A" }]}>{n}</Text>}
                </View>
                <Text style={[styles.stepLabel, active && { color: colors.gold }]}>{labels[n - 1]}</Text>
              </View>
            );
          })}
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {/* ============= STEP 1: OPTIONS ============= */}
          {step === 1 && (
            <>
              <Text style={styles.bigTitle}>Créez votre formule sur-mesure</Text>
              <Text style={styles.bigSub}>Choisissez les prestations qui vous intéressent. Notre équipe vous proposera une formule personnalisée adaptée à votre projet.</Text>

              <View style={styles.searchWrap}>
                <Ionicons name="search" size={16} color={colors.textSecondary} />
                <TextInput
                  style={styles.searchInput}
                  value={search}
                  onChangeText={setSearch}
                  placeholder="Rechercher une option (ex: drone, cérémonie, album…)"
                  placeholderTextColor={colors.textDisabled}
                />
              </View>

              {!catalog && <ActivityIndicator color={colors.gold} style={{ marginTop: 30 }} />}

              {catalog && (
                <>
                  {/* COUVERTURE */}
                  <SectionHeader icon="film" title="Couverture" subtitle="Sélectionnez les moments à capturer" />
                  <View style={styles.itemsGrid}>
                    {catalog.couverture.filter((i) => matchSearch(i.label)).map((it) => (
                      <ItemCard key={it.id} item={it} selected={coverageSel.has(it.id)} onToggle={() => toggle(coverageSel, setCoverageSel, it.id)} />
                    ))}
                  </View>

                  {/* OPTIONS */}
                  <SectionHeader icon="sparkles" title="Options" subtitle="Ajoutez des prestations supplémentaires" />
                  <View style={styles.itemsGrid}>
                    {catalog.options.filter((i) => matchSearch(i.label)).map((it) => (
                      <ItemCard key={it.id} item={it} selected={optionsSel.has(it.id)} onToggle={() => toggle(optionsSel, setOptionsSel, it.id)} />
                    ))}
                  </View>

                  {/* LIVRABLES */}
                  <SectionHeader icon="gift" title="Livrables" subtitle="Choisissez vos formats de livraison" />
                  <View style={styles.itemsGrid}>
                    {catalog.livrables.filter((i) => matchSearch(i.label)).map((it) => (
                      <ItemCard key={it.id} item={it} selected={livrablesSel.has(it.id)} onToggle={() => toggle(livrablesSel, setLivrablesSel, it.id)} />
                    ))}
                  </View>
                </>
              )}
            </>
          )}

          {/* ============= STEP 2: DATE ============= */}
          {step === 2 && (
            <>
              <Text style={styles.bigTitle}>Votre événement</Text>
              <Text style={styles.bigSub}>Quelques détails sur votre mariage pour personnaliser notre proposition.</Text>

              <Text style={styles.label}>Date du mariage *</Text>
              <TextInput
                style={styles.input}
                value={weddingDate}
                onChangeText={setWeddingDate}
                placeholder="JJ/MM/AAAA ou à définir"
                placeholderTextColor={colors.textDisabled}
                testID="devis-date"
              />

              <Text style={styles.label}>Lieu / Ville</Text>
              <TextInput
                style={styles.input}
                value={location}
                onChangeText={setLocation}
                placeholder="Ex : Paris, Marseille…"
                placeholderTextColor={colors.textDisabled}
                testID="devis-location"
              />

              <Text style={styles.label}>Nombre d'invités estimé</Text>
              <TextInput
                style={styles.input}
                value={guestsCount}
                onChangeText={(v) => setGuestsCount(v.replace(/[^0-9]/g, ""))}
                placeholder="Ex : 120"
                placeholderTextColor={colors.textDisabled}
                keyboardType="numeric"
                testID="devis-guests"
              />

              <Text style={styles.label}>Type(s) de cérémonie</Text>
              <View style={styles.chipsRow}>
                {CEREMONY_TYPES.map((c) => {
                  const active = ceremonySel.has(c);
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[styles.chip, active && styles.chipActive]}
                      onPress={() => toggle(ceremonySel, setCeremonySel, c)}
                    >
                      <Text style={[styles.chipTxt, active && { color: "#0A0A0A", fontWeight: "700" }]}>{c}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
            </>
          )}

          {/* ============= STEP 3: COORDONNÉES ============= */}
          {step === 3 && (
            <>
              <Text style={styles.bigTitle}>Vos coordonnées</Text>
              <Text style={styles.bigSub}>Pour vous recontacter avec votre devis personnalisé sous 48h.</Text>

              <Text style={styles.label}>Prénom *</Text>
              <TextInput style={styles.input} value={contactName} onChangeText={setContactName} placeholder="Votre prénom" placeholderTextColor={colors.textDisabled} testID="devis-name" />

              <Text style={styles.label}>Prénom de votre partenaire</Text>
              <TextInput style={styles.input} value={partnerName} onChangeText={setPartnerName} placeholder="Prénom du/de la marié(e)" placeholderTextColor={colors.textDisabled} testID="devis-partner" />

              <Text style={styles.label}>Email *</Text>
              <TextInput style={styles.input} value={email} onChangeText={setEmail} placeholder="votre@email.com" placeholderTextColor={colors.textDisabled} keyboardType="email-address" autoCapitalize="none" testID="devis-email" />

              <Text style={styles.label}>Téléphone *</Text>
              <TextInput style={styles.input} value={phone} onChangeText={setPhone} placeholder="06 12 34 56 78" placeholderTextColor={colors.textDisabled} keyboardType="phone-pad" testID="devis-phone" />

              <Text style={styles.label}>Comment nous avez-vous connu ?</Text>
              <View style={styles.chipsRow}>
                {SOURCES.map((s) => (
                  <TouchableOpacity key={s} style={[styles.chip, source === s && styles.chipActive]} onPress={() => setSource(s)}>
                    <Text style={[styles.chipTxt, source === s && { color: "#0A0A0A", fontWeight: "700" }]}>{s}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <Text style={styles.label}>Un message ou une précision ?</Text>
              <TextInput
                style={[styles.input, { minHeight: 100, textAlignVertical: "top" }]}
                value={customMessage}
                onChangeText={setCustomMessage}
                placeholder="Décrivez votre projet, vos envies, vos contraintes…"
                placeholderTextColor={colors.textDisabled}
                multiline
                maxLength={4000}
                testID="devis-message"
              />

              <TouchableOpacity style={styles.rgpdRow} onPress={() => setAcceptedTerms(!acceptedTerms)} testID="devis-rgpd">
                <Ionicons name={acceptedTerms ? "checkbox" : "square-outline"} size={22} color={acceptedTerms ? colors.gold : colors.textSecondary} />
                <Text style={styles.rgpdTxt}>
                  J'accepte que mes données soient utilisées uniquement pour traiter ma demande de devis (RGPD).{" "}
                  <Text style={styles.rgpdLink} onPress={() => router.push("/legal/privacy")}>Politique de confidentialité</Text>
                </Text>
              </TouchableOpacity>
            </>
          )}
        </ScrollView>

        {/* FOOTER ACTIONS */}
        <View style={styles.footer}>
          {step > 1 && (
            <TouchableOpacity style={styles.backBtn} onPress={() => setStep((step - 1) as any)} disabled={submitting} testID="devis-prev">
              <Ionicons name="chevron-back" size={18} color={colors.ivory} />
              <Text style={styles.backBtnTxt}>Précédent</Text>
            </TouchableOpacity>
          )}
          {step < 3 ? (
            <TouchableOpacity
              style={styles.nextBtn}
              onPress={() => {
                if (step === 1 && !validateStep1()) return;
                if (step === 2 && !validateStep2()) return;
                setStep((step + 1) as any);
              }}
              testID="devis-next"
            >
              <Text style={styles.nextBtnTxt}>Continuer {step === 1 && totalSelected > 0 ? `(${totalSelected})` : ""}</Text>
              <Ionicons name="chevron-forward" size={18} color="#0A0A0A" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.submitBtn, submitting && { opacity: 0.5 }]}
              onPress={submit}
              disabled={submitting}
              testID="devis-submit"
            >
              {submitting ? (
                <ActivityIndicator color="#0A0A0A" />
              ) : (
                <>
                  <Ionicons name="send" size={16} color="#0A0A0A" />
                  <Text style={styles.nextBtnTxt}>Envoyer ma demande</Text>
                </>
              )}
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ============= SUB-COMPONENTS =============
function SectionHeader({ icon, title, subtitle }: { icon: any; title: string; subtitle: string }) {
  return (
    <View style={styles.sectionHeader}>
      <Ionicons name={icon} size={20} color={colors.gold} />
      <View>
        <Text style={styles.sectionTitle}>{title}</Text>
        <Text style={styles.sectionSub}>{subtitle}</Text>
      </View>
    </View>
  );
}

function ItemCard({ item, selected, onToggle }: { item: CatalogItem; selected: boolean; onToggle: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.itemCard, selected && styles.itemCardSelected]}
      onPress={onToggle}
      activeOpacity={0.85}
      testID={`devis-item-${item.id}`}
    >
      <Text style={[styles.itemLabel, selected && { color: colors.gold, fontWeight: "700" }]}>{item.label}</Text>
      <View style={styles.itemRight}>
        {item.price > 0 && <Text style={[styles.itemPrice, selected && { color: colors.gold }]}>{item.price}€</Text>}
        <View style={[styles.itemCheckbox, selected && styles.itemCheckboxOn]}>
          {selected && <Ionicons name="checkmark" size={14} color="#0A0A0A" />}
        </View>
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 10 },
  headerTitle: { flex: 1, color: colors.ivory, fontSize: 18, fontWeight: "700", textAlign: "center" },

  stepperWrap: { flexDirection: "row", justifyContent: "center", alignItems: "flex-start", gap: 36, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border },
  stepperItem: { alignItems: "center", gap: 6 },
  stepDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1.5, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  stepDotActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  stepDotDone: { backgroundColor: colors.gold, borderColor: colors.gold },
  stepDotTxt: { color: colors.ivory, fontSize: 13, fontWeight: "700" },
  stepLabel: { color: colors.textSecondary, fontSize: 11, letterSpacing: 0.3 },

  scroll: { padding: spacing.md, paddingBottom: 30 },
  bigTitle: { color: colors.ivory, fontSize: 22, fontWeight: "800", marginTop: 8 },
  bigSub: { color: colors.textSecondary, fontSize: 13, lineHeight: 19, marginTop: 6, marginBottom: 18 },

  searchWrap: { flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: colors.surface, paddingHorizontal: 14, paddingVertical: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border, marginBottom: 16 },
  searchInput: { flex: 1, color: colors.ivory, fontSize: 13, padding: 0 },

  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 22, marginBottom: 10 },
  sectionTitle: { color: colors.ivory, fontSize: 16, fontWeight: "700" },
  sectionSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },

  itemsGrid: { gap: 8 },
  itemCard: { flexDirection: "row", alignItems: "center", padding: 14, borderRadius: radii.sm, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  itemCardSelected: { borderColor: colors.gold, backgroundColor: "rgba(212,175,55,0.06)" },
  itemLabel: { flex: 1, color: colors.ivory, fontSize: 14 },
  itemRight: { flexDirection: "row", alignItems: "center", gap: 10 },
  itemPrice: { color: colors.ivory, fontWeight: "700", fontSize: 14 },
  itemCheckbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: colors.textDisabled, alignItems: "center", justifyContent: "center" },
  itemCheckboxOn: { backgroundColor: colors.gold, borderColor: colors.gold },

  label: { color: colors.textSecondary, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", marginTop: 14, marginBottom: 6 },
  input: { backgroundColor: colors.surface, color: colors.ivory, borderRadius: radii.sm, paddingHorizontal: 14, paddingVertical: 13, fontSize: 14, borderWidth: 1, borderColor: colors.border },

  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  chipTxt: { color: colors.ivory, fontSize: 12 },

  rgpdRow: { flexDirection: "row", alignItems: "flex-start", gap: 10, padding: 12, marginTop: 18, backgroundColor: colors.surface, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border },
  rgpdTxt: { flex: 1, color: colors.textSecondary, fontSize: 12, lineHeight: 18 },
  rgpdLink: { color: colors.gold, textDecorationLine: "underline" },

  footer: { flexDirection: "row", gap: 10, padding: spacing.md, paddingBottom: Platform.OS === "ios" ? 22 : 16, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.bg },
  backBtn: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 14, paddingHorizontal: 18, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  backBtnTxt: { color: colors.ivory, fontWeight: "600", fontSize: 13 },
  nextBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.gold, paddingVertical: 16, borderRadius: radii.sm },
  submitBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8, backgroundColor: colors.gold, paddingVertical: 16, borderRadius: radii.sm },
  nextBtnTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 14, letterSpacing: 0.4 },

  // Success screen
  successScreen: { flexGrow: 1, padding: spacing.md, justifyContent: "center" },
  successHero: { alignItems: "center", padding: 30, borderRadius: radii.md, gap: 14 },
  successIcon: { width: 80, height: 80, borderRadius: 40, backgroundColor: colors.gold, alignItems: "center", justifyContent: "center", marginBottom: 6 },
  successTitle: { color: colors.ivory, fontSize: 26, fontWeight: "800", textAlign: "center" },
  successSub: { color: colors.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 21 },
  successCard: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, padding: 14, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.border, width: "100%" },
  successCardTxt: { flex: 1, color: colors.ivory, fontSize: 13, lineHeight: 19 },
  backHomeBtn: { marginTop: 16, paddingVertical: 14, paddingHorizontal: 22, backgroundColor: colors.gold, borderRadius: radii.sm },
  backHomeTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 14 },
});

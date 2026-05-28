/**
 * Admin: list & manage quote requests (Devis).
 * Statuses: new → in_progress → sent → accepted/refused/archived.
 */
import { useCallback, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Modal,
  TextInput,
  Platform,
  Linking,
} from "react-native";
import { useRouter, useFocusEffect } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { useAuth } from "@/src/auth/AuthContext";
import { showAlert, showConfirm } from "@/src/utils/dialog";
import { colors, spacing, radii } from "@/src/theme";

type QuoteItem = { id: string; label: string; price: number };
type Quote = {
  id: string;
  status: "new" | "in_progress" | "sent" | "accepted" | "refused" | "archived";
  created_at: string;
  wedding_date: string;
  location: string;
  guests_count: number | null;
  ceremony_types: string[];
  coverage_items: QuoteItem[];
  options_items: QuoteItem[];
  deliverables_items: QuoteItem[];
  custom_message: string;
  contact_name: string;
  partner_name: string;
  email: string;
  phone: string;
  source: string;
  admin_notes: string;
  computed_total_min: number;
};

const STATUSES: { key: Quote["status"] | "all"; label: string; color: string }[] = [
  { key: "all", label: "Tous", color: colors.textSecondary },
  { key: "new", label: "Nouveau", color: "#D4AF37" },
  { key: "in_progress", label: "En cours", color: "#4FC3F7" },
  { key: "sent", label: "Devis envoyé", color: "#BA68C8" },
  { key: "accepted", label: "Accepté", color: "#4CAF50" },
  { key: "refused", label: "Refusé", color: "#EF5350" },
  { key: "archived", label: "Archivé", color: "#757575" },
];

const STATUS_LABEL = (s: Quote["status"]) => STATUSES.find(x => x.key === s)?.label || s;
const STATUS_COLOR = (s: Quote["status"]) => STATUSES.find(x => x.key === s)?.color || colors.textSecondary;

export default function AdminDevis() {
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [filter, setFilter] = useState<Quote["status"] | "all">("all");
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedQuote, setSelectedQuote] = useState<Quote | null>(null);
  const [editingNotes, setEditingNotes] = useState("");
  const [updating, setUpdating] = useState(false);

  const load = useCallback(async () => {
    try {
      const qs = filter === "all" ? "" : `?status=${filter}`;
      const r = await api<{ quotes: Quote[]; counts: Record<string, number> }>(`/admin/devis${qs}`);
      setQuotes(r.quotes || []);
      setCounts(r.counts || {});
    } catch (e: any) {
      showAlert("Erreur", e.message || "Erreur de chargement");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useFocusEffect(useCallback(() => {
    if (!user || !user.is_admin) return;
    load();
  }, [user, load]));

  if (authLoading || (!user || !user.is_admin)) {
    if (!authLoading) setTimeout(() => router.replace("/admin"), 50);
    return <View style={styles.loading}><ActivityIndicator color={colors.gold} /></View>;
  }

  const updateStatus = async (id: string, status: Quote["status"]) => {
    setUpdating(true);
    try {
      const r = await api<{ quote: Quote }>(`/admin/devis/${id}`, { method: "PATCH", body: { status } });
      setQuotes((prev) => prev.map((q) => q.id === id ? r.quote : q));
      if (selectedQuote?.id === id) setSelectedQuote(r.quote);
    } catch (e: any) {
      showAlert("Erreur", e.message);
    } finally {
      setUpdating(false);
    }
  };

  const saveNotes = async (id: string) => {
    setUpdating(true);
    try {
      const r = await api<{ quote: Quote }>(`/admin/devis/${id}`, { method: "PATCH", body: { admin_notes: editingNotes } });
      setQuotes((prev) => prev.map((q) => q.id === id ? r.quote : q));
      setSelectedQuote(r.quote);
      showAlert("✓", "Notes enregistrées");
    } catch (e: any) {
      showAlert("Erreur", e.message);
    } finally {
      setUpdating(false);
    }
  };

  const deleteQuote = async (q: Quote) => {
    const ok = await showConfirm(
      "Supprimer ce devis ?",
      `La demande de ${q.contact_name} sera définitivement supprimée.`,
      { confirmText: "Supprimer", destructive: true }
    );
    if (!ok) return;
    try {
      await api(`/admin/devis/${q.id}`, { method: "DELETE" });
      setQuotes((prev) => prev.filter((x) => x.id !== q.id));
      setSelectedQuote(null);
    } catch (e: any) {
      showAlert("Erreur", e.message);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <View style={{ flex: 1, alignItems: "center" }}>
          <Text style={styles.headerTitle}>Demandes de devis</Text>
          <Text style={styles.headerSub}>
            {(counts.new || 0)} nouveau{(counts.new || 0) > 1 ? "x" : ""} · {Object.values(counts).reduce((a, b) => a + b, 0)} au total
          </Text>
        </View>
        <View style={{ width: 26 }} />
      </View>

      {/* FILTER CHIPS */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
        {STATUSES.map((f) => {
          const active = filter === f.key;
          const count = f.key === "all" ? Object.values(counts).reduce((a, b) => a + b, 0) : (counts[f.key] || 0);
          return (
            <TouchableOpacity key={f.key} style={[styles.filterChip, active && { backgroundColor: f.color, borderColor: f.color }]} onPress={() => setFilter(f.key as any)}>
              <Text style={[styles.filterChipTxt, active && { color: "#0A0A0A", fontWeight: "700" }]}>{f.label} {count > 0 ? `(${count})` : ""}</Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.gold} /></View>
      ) : (
        <FlatList
          data={quotes}
          keyExtractor={(q) => q.id}
          contentContainerStyle={{ padding: spacing.md, paddingBottom: 60 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />}
          ListEmptyComponent={<Text style={styles.empty}>Aucune demande dans cette catégorie.</Text>}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={[styles.card, item.status === "new" && styles.cardNew]}
              onPress={() => { setSelectedQuote(item); setEditingNotes(item.admin_notes || ""); }}
              testID={`devis-card-${item.id}`}
            >
              <View style={[styles.statusBadge, { backgroundColor: STATUS_COLOR(item.status) }]}>
                <Text style={styles.statusBadgeTxt}>{STATUS_LABEL(item.status)}</Text>
              </View>
              <Text style={styles.cardName}>
                {item.contact_name}{item.partner_name ? ` & ${item.partner_name}` : ""}
              </Text>
              <Text style={styles.cardEmail}>{item.email} · {item.phone}</Text>
              <View style={styles.cardMetaRow}>
                <Text style={styles.cardMeta}>📅 {item.wedding_date || "À définir"}</Text>
                {item.location ? <Text style={styles.cardMeta}>📍 {item.location}</Text> : null}
                {item.guests_count ? <Text style={styles.cardMeta}>👥 {item.guests_count}</Text> : null}
              </View>
              <View style={styles.cardMetaRow}>
                <Text style={styles.cardItemsCount}>
                  {item.coverage_items.length + item.options_items.length + item.deliverables_items.length} prestation(s)
                </Text>
                {item.computed_total_min > 0 && (
                  <Text style={styles.cardTotal}>~{item.computed_total_min}€</Text>
                )}
              </View>
              <Text style={styles.cardDate}>{new Date(item.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* DETAIL MODAL */}
      <Modal visible={!!selectedQuote} animationType="slide" onRequestClose={() => setSelectedQuote(null)}>
        {selectedQuote && (
          <SafeAreaView style={styles.root} edges={["top"]}>
            <View style={styles.header}>
              <TouchableOpacity onPress={() => setSelectedQuote(null)}>
                <Ionicons name="close" size={26} color={colors.ivory} />
              </TouchableOpacity>
              <Text style={styles.headerTitle}>Détail du devis</Text>
              <TouchableOpacity onPress={() => deleteQuote(selectedQuote)} testID="devis-delete-btn">
                <Ionicons name="trash" size={22} color="#EF5350" />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: 40 }}>
              {/* STATUS PICKER */}
              <Text style={styles.label}>Statut</Text>
              <View style={styles.statusPickerRow}>
                {STATUSES.filter(s => s.key !== "all").map(s => {
                  const active = selectedQuote.status === s.key;
                  return (
                    <TouchableOpacity
                      key={s.key}
                      style={[styles.statusPickerChip, active && { backgroundColor: s.color, borderColor: s.color }]}
                      onPress={() => updateStatus(selectedQuote.id, s.key as any)}
                      disabled={updating}
                    >
                      <Text style={[styles.statusPickerTxt, active && { color: "#0A0A0A", fontWeight: "700" }]}>{s.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* CONTACT */}
              <Section title="Couple">
                <DetailLine label="Nom" value={`${selectedQuote.contact_name}${selectedQuote.partner_name ? ` & ${selectedQuote.partner_name}` : ""}`} />
                <DetailLine label="Email" value={selectedQuote.email} onPress={() => Linking.openURL(`mailto:${selectedQuote.email}`)} />
                <DetailLine label="Téléphone" value={selectedQuote.phone} onPress={() => Linking.openURL(`tel:${selectedQuote.phone}`)} />
                {selectedQuote.source && <DetailLine label="Source" value={selectedQuote.source} />}
              </Section>

              <Section title="Événement">
                <DetailLine label="Date" value={selectedQuote.wedding_date || "À définir"} />
                <DetailLine label="Lieu" value={selectedQuote.location || "-"} />
                <DetailLine label="Invités" value={selectedQuote.guests_count?.toString() || "-"} />
                {selectedQuote.ceremony_types?.length > 0 && (
                  <DetailLine label="Cérémonies" value={selectedQuote.ceremony_types.join(", ")} />
                )}
              </Section>

              {selectedQuote.coverage_items.length > 0 && (
                <Section title="Couverture">
                  {selectedQuote.coverage_items.map(it => (
                    <View key={it.id} style={styles.itemLine}>
                      <Text style={styles.itemLineLbl}>{it.label}</Text>
                      {it.price > 0 && <Text style={styles.itemLinePrice}>{it.price}€</Text>}
                    </View>
                  ))}
                </Section>
              )}

              {selectedQuote.options_items.length > 0 && (
                <Section title="Options">
                  {selectedQuote.options_items.map(it => (
                    <View key={it.id} style={styles.itemLine}>
                      <Text style={styles.itemLineLbl}>{it.label}</Text>
                      <Text style={styles.itemLinePrice}>{it.price}€</Text>
                    </View>
                  ))}
                </Section>
              )}

              {selectedQuote.deliverables_items.length > 0 && (
                <Section title="Livrables">
                  {selectedQuote.deliverables_items.map(it => (
                    <View key={it.id} style={styles.itemLine}>
                      <Text style={styles.itemLineLbl}>{it.label}</Text>
                      <Text style={styles.itemLinePrice}>{it.price}€</Text>
                    </View>
                  ))}
                </Section>
              )}

              {selectedQuote.computed_total_min > 0 && (
                <View style={styles.totalBox}>
                  <Text style={styles.totalLabel}>Total minimum estimé</Text>
                  <Text style={styles.totalValue}>{selectedQuote.computed_total_min}€</Text>
                </View>
              )}

              {selectedQuote.custom_message && (
                <Section title="Message du couple">
                  <Text style={styles.customMsg}>{selectedQuote.custom_message}</Text>
                </Section>
              )}

              <Section title="Notes admin (privées)">
                <TextInput
                  style={[styles.input, { minHeight: 100, textAlignVertical: "top" }]}
                  value={editingNotes}
                  onChangeText={setEditingNotes}
                  placeholder="Vos notes internes…"
                  placeholderTextColor={colors.textDisabled}
                  multiline
                />
                <TouchableOpacity
                  style={styles.saveNotesBtn}
                  onPress={() => saveNotes(selectedQuote.id)}
                  disabled={updating}
                >
                  <Text style={styles.saveNotesTxt}>{updating ? "..." : "Enregistrer les notes"}</Text>
                </TouchableOpacity>
              </Section>
            </ScrollView>
          </SafeAreaView>
        )}
      </Modal>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: any }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{title}</Text>
      {children}
    </View>
  );
}

function DetailLine({ label, value, onPress }: { label: string; value: string; onPress?: () => void }) {
  return (
    <View style={styles.detailLine}>
      <Text style={styles.detailLabel}>{label}</Text>
      {onPress ? (
        <TouchableOpacity onPress={onPress}><Text style={[styles.detailValue, { color: colors.gold, textDecorationLine: "underline" }]}>{value}</Text></TouchableOpacity>
      ) : (
        <Text style={styles.detailValue}>{value}</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: 10 },
  headerTitle: { color: colors.ivory, fontSize: 17, fontWeight: "700" },
  headerSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },

  filters: { flexDirection: "row", paddingHorizontal: spacing.md, paddingBottom: 10, gap: 6 },
  filterChip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  filterChipTxt: { color: colors.ivory, fontSize: 12 },

  empty: { color: colors.textSecondary, textAlign: "center", marginTop: 60, fontStyle: "italic" },

  card: { padding: 14, backgroundColor: colors.surface, borderRadius: radii.md, marginBottom: 10, borderWidth: 1, borderColor: colors.border, position: "relative" },
  cardNew: { borderColor: colors.gold, backgroundColor: "rgba(212,175,55,0.05)" },
  statusBadge: { position: "absolute", top: 12, right: 12, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  statusBadgeTxt: { color: "#0A0A0A", fontSize: 9, fontWeight: "800", letterSpacing: 0.4 },
  cardName: { color: colors.ivory, fontSize: 15, fontWeight: "700", paddingRight: 80 },
  cardEmail: { color: colors.textSecondary, fontSize: 12, marginTop: 3 },
  cardMetaRow: { flexDirection: "row", gap: 12, marginTop: 8, flexWrap: "wrap" },
  cardMeta: { color: colors.textSecondary, fontSize: 11 },
  cardItemsCount: { color: colors.gold, fontSize: 12, fontWeight: "600" },
  cardTotal: { color: colors.gold, fontSize: 13, fontWeight: "700" },
  cardDate: { color: colors.textDisabled, fontSize: 10, marginTop: 8 },

  label: { color: colors.textSecondary, fontSize: 11, letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 6 },
  input: { backgroundColor: colors.surface, color: colors.ivory, borderRadius: radii.sm, paddingHorizontal: 14, paddingVertical: 12, fontSize: 13, borderWidth: 1, borderColor: colors.border },

  statusPickerRow: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 16 },
  statusPickerChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface },
  statusPickerTxt: { color: colors.ivory, fontSize: 11 },

  section: { marginBottom: 18 },
  sectionLabel: { color: colors.gold, fontSize: 12, fontWeight: "700", letterSpacing: 0.5, textTransform: "uppercase", marginBottom: 8 },
  detailLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6 },
  detailLabel: { color: colors.textSecondary, fontSize: 13 },
  detailValue: { color: colors.ivory, fontSize: 13, flex: 1, textAlign: "right" },
  itemLine: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 5 },
  itemLineLbl: { color: colors.ivory, fontSize: 13 },
  itemLinePrice: { color: colors.gold, fontWeight: "700", fontSize: 13 },
  totalBox: { backgroundColor: "rgba(212,175,55,0.08)", borderWidth: 1, borderColor: "rgba(212,175,55,0.4)", padding: 14, borderRadius: radii.sm, flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 18 },
  totalLabel: { color: colors.ivory, fontSize: 13, fontWeight: "600" },
  totalValue: { color: colors.gold, fontSize: 18, fontWeight: "800" },
  customMsg: { color: colors.ivory, fontSize: 13, backgroundColor: colors.surface, padding: 12, borderRadius: radii.sm, lineHeight: 19 },
  saveNotesBtn: { backgroundColor: colors.gold, paddingVertical: 12, borderRadius: radii.sm, alignItems: "center", marginTop: 8 },
  saveNotesTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 13 },
});

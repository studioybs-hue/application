import { useEffect, useState, useCallback } from "react";
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import { showAlert, confirmAction, showConfirm } from "@/src/utils/dialog";

type HReq = {
  id: string;
  user_id: string;
  user_email?: string;
  couple_name: string;
  wedding_date?: string | null;
  location?: string;
  contact_email?: string;
  contact_phone?: string;
  description?: string;
  drive_link?: string;
  notes?: string;
  status: "pending_payment" | "paid" | "in_progress" | "published" | "rejected" | "abandoned" | "pending";
  amount?: number;
  currency?: string;
  client_id?: string | null;
  created_at?: string | null;
  paid_at?: string | null;
  published_at?: string | null;
};

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_payment: { label: "EN ATTENTE PAIEMENT", color: "#888" },
  pending: { label: "EN ATTENTE PAIEMENT", color: "#888" },
  paid: { label: "PAYÉ • À MONTER", color: "#D4AF37" },
  in_progress: { label: "EN COURS", color: "#3B82F6" },
  published: { label: "PUBLIÉ", color: "#10B981" },
  rejected: { label: "REJETÉ", color: "#EF4444" },
  abandoned: { label: "ABANDONNÉ", color: "#6B7280" },
};

export default function AdminHosting() {
  const router = useRouter();
  const [requests, setRequests] = useState<HReq[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api<{ requests: HReq[] }>("/admin/hosting/requests");
      setRequests(r.requests);
    } catch (e: any) {
      console.error(e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const publish = (h: HReq) => {
    confirmAction(
      "Publier ce mariage",
      `Cela créera l'espace mariage de « ${h.couple_name} » et le liera au compte ${h.user_email}. Vous pourrez ensuite uploader les vidéos via /admin/videos.`,
      async () => {
        setActing(h.id);
        try {
          const r = await api<{ client_id: string }>(`/admin/hosting/requests/${h.id}/publish`, { method: "POST", body: {} });
          await load();
          showAlert("✓ Publié", `Mariage créé (client_id: ${r.client_id}). Allez sur /admin/videos pour uploader les films.`);
        } catch (e: any) {
          showAlert("Erreur", e.message);
        } finally {
          setActing(null);
        }
      },
      { confirmText: "Publier" }
    );
  };

  const reject = (h: HReq) => {
    confirmAction(
      "Rejeter la demande",
      `Marquer la demande de « ${h.couple_name} » comme REJETÉE ? (Le remboursement Stripe est à faire manuellement.)`,
      async () => {
        setActing(h.id);
        try {
          await api(`/admin/hosting/requests/${h.id}/reject`, { method: "POST", body: {} });
          await load();
        } catch (e: any) {
          showAlert("Erreur", e.message);
        } finally {
          setActing(null);
        }
      },
      { destructive: true, confirmText: "Rejeter" }
    );
  };

  const markAbandoned = async (h: HReq) => {
    const ok = await showConfirm(
      "Marquer comme abandonné",
      `Marquer la demande de « ${h.couple_name} » comme ABANDONNÉE ? (Vous pourrez toujours la supprimer plus tard.)`,
    );
    if (!ok) return;
    setActing(h.id);
    try {
      await api(`/admin/hosting/requests/${h.id}`, { method: "PATCH", body: { status: "abandoned" } });
      await load();
    } catch (e: any) {
      showAlert("Erreur", e.message);
    } finally {
      setActing(null);
    }
  };

  const deleteRequest = async (h: HReq) => {
    const ok = await showConfirm(
      "Supprimer définitivement ?",
      `Cette action est IRRÉVERSIBLE. La demande de « ${h.couple_name} » sera effacée de la base.`,
      { destructive: true, confirmText: "Supprimer" }
    );
    if (!ok) return;
    setActing(h.id);
    try {
      await api(`/admin/hosting/requests/${h.id}`, { method: "DELETE" });
      await load();
      showAlert("✓ Supprimé", `Demande de ${h.couple_name} supprimée.`);
    } catch (e: any) {
      showAlert("Erreur", e.message);
    } finally {
      setActing(null);
    }
  };

  const pending = requests.filter((r) => r.status === "paid" || r.status === "in_progress");
  const published = requests.filter((r) => r.status === "published");
  const other = requests.filter((r) => !["paid", "in_progress", "published"].includes(r.status));

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={styles.title}>Demandes d'hébergement</Text>
        <View style={{ width: 26 }} />
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.gold} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md }}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} tintColor={colors.gold} />
          }
        >
          {requests.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="mail-open-outline" size={48} color={colors.gold} />
              <Text style={styles.emptyTxt}>Aucune demande pour l'instant.</Text>
              <Text style={styles.emptySub}>
                Les couples qui paieront les 90€ via /host apparaîtront ici.
              </Text>
            </View>
          ) : (
            <>
              {pending.length > 0 && (
                <>
                  <Text style={styles.sectionTitle}>🔥 À traiter ({pending.length})</Text>
                  {pending.map((h) => (
                    <Card key={h.id} req={h} onPublish={publish} onReject={reject} onAbandon={markAbandoned} onDelete={deleteRequest} acting={acting === h.id} />
                  ))}
                </>
              )}
              {published.length > 0 && (
                <>
                  <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>✓ Publiés ({published.length})</Text>
                  {published.map((h) => (
                    <Card key={h.id} req={h} onPublish={publish} onReject={reject} onAbandon={markAbandoned} onDelete={deleteRequest} acting={acting === h.id} />
                  ))}
                </>
              )}
              {other.length > 0 && (
                <>
                  <Text style={[styles.sectionTitle, { marginTop: spacing.lg }]}>Autres ({other.length})</Text>
                  {other.map((h) => (
                    <Card key={h.id} req={h} onPublish={publish} onReject={reject} onAbandon={markAbandoned} onDelete={deleteRequest} acting={acting === h.id} />
                  ))}
                </>
              )}
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Card({
  req, onPublish, onReject, onAbandon, onDelete, acting,
}: { req: HReq; onPublish: (r: HReq) => void; onReject: (r: HReq) => void; onAbandon: (r: HReq) => void; onDelete: (r: HReq) => void; acting: boolean }) {
  const sl = STATUS_LABELS[req.status] || STATUS_LABELS.pending_payment;
  const isActionable = req.status === "paid" || req.status === "in_progress";
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.coupleName}>{req.couple_name}</Text>
          <Text style={styles.email}>{req.user_email || req.contact_email}</Text>
        </View>
        <View style={[styles.statusPill, { backgroundColor: sl.color }]}>
          <Text style={styles.statusTxt}>{sl.label}</Text>
        </View>
      </View>

      <View style={styles.divider} />

      {req.wedding_date ? <Row icon="calendar" label="Date" value={req.wedding_date} /> : null}
      {req.location ? <Row icon="location" label="Lieu" value={req.location} /> : null}
      {req.contact_phone ? <Row icon="call" label="Tél" value={req.contact_phone} /> : null}
      {req.description ? <Row icon="document-text" label="Description" value={req.description} multiline /> : null}
      {req.drive_link ? <Row icon="cloud-download" label="Drive" value={req.drive_link} link /> : null}
      {req.notes ? <Row icon="chatbox" label="Notes" value={req.notes} multiline /> : null}
      {req.paid_at ? <Row icon="checkmark-circle" label="Payé le" value={new Date(req.paid_at).toLocaleString("fr-FR")} /> : null}
      {req.client_id ? <Row icon="link" label="Mariage" value={req.client_id} /> : null}

      <View style={styles.actions}>
        {isActionable && (
          <TouchableOpacity style={styles.publishBtn} onPress={() => onPublish(req)} disabled={acting} testID={`publish-${req.id}`}>
            {acting ? <ActivityIndicator color="#0A0A0A" /> : (
              <>
                <Ionicons name="checkmark" size={16} color="#0A0A0A" />
                <Text style={styles.publishTxt}>Publier le mariage</Text>
              </>
            )}
          </TouchableOpacity>
        )}
        {req.status !== "published" && req.status !== "abandoned" && (
          <TouchableOpacity style={styles.secondaryBtn} onPress={() => onAbandon(req)} disabled={acting} testID={`abandon-${req.id}`}>
            <Ionicons name="archive-outline" size={14} color={colors.textSecondary} />
            <Text style={styles.secondaryTxt}>Abandonné</Text>
          </TouchableOpacity>
        )}
        {isActionable && (
          <TouchableOpacity style={styles.rejectBtn} onPress={() => onReject(req)} disabled={acting}>
            <Ionicons name="close" size={16} color={colors.error} />
          </TouchableOpacity>
        )}
        {req.status !== "published" && (
          <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(req)} disabled={acting} testID={`delete-req-${req.id}`}>
            <Ionicons name="trash-outline" size={16} color={colors.error} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

function Row({ icon, label, value, multiline, link }: { icon: any; label: string; value: string; multiline?: boolean; link?: boolean }) {
  return (
    <View style={styles.row}>
      <Ionicons name={icon} size={14} color={colors.gold} style={{ marginTop: 2 }} />
      <Text style={styles.rowLabel}>{label}:</Text>
      <Text
        style={[styles.rowValue, link && { color: colors.gold, textDecorationLine: "underline" }]}
        numberOfLines={multiline ? 4 : 1}
        selectable
      >
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.md },
  title: { flex: 1, color: colors.ivory, fontSize: 20, fontWeight: "700" },
  sectionTitle: { color: colors.gold, fontSize: 13, fontWeight: "700", letterSpacing: 1, marginBottom: 10 },
  card: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.md, borderWidth: 1, borderColor: colors.border },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  coupleName: { color: colors.ivory, fontSize: 17, fontWeight: "700" },
  email: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  statusPill: { paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  statusTxt: { color: "#0A0A0A", fontSize: 9, fontWeight: "800", letterSpacing: 1 },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: 10 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 6, marginBottom: 6 },
  rowLabel: { color: colors.textSecondary, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  rowValue: { color: colors.ivory, fontSize: 12, flex: 1 },
  actions: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" },
  publishBtn: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, backgroundColor: colors.gold, paddingVertical: 12, borderRadius: 8 },
  publishTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 13 },
  rejectBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.error, borderRadius: 8 },
  secondaryBtn: { flexDirection: "row", alignItems: "center", gap: 4, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  secondaryTxt: { color: colors.textSecondary, fontSize: 12, fontWeight: "600" },
  deleteBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.error, borderRadius: 8, backgroundColor: "rgba(239, 68, 68, 0.08)" },
  empty: { alignItems: "center", paddingTop: 80, gap: 12 },
  emptyTxt: { color: colors.ivory, fontSize: 16, fontWeight: "600" },
  emptySub: { color: colors.textSecondary, fontSize: 13, textAlign: "center", paddingHorizontal: spacing.lg, lineHeight: 18 },
});

import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Modal,
  TextInput,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import type { ProjectTracking } from "@/src/features/project-tracking/ProjectTrackingView";

type Candidate = {
  client_id: string;
  wedding_name: string;
  owner_email?: string | null;
  owner_phone?: string | null;
  source?: string;
};

export default function AdminProjectsList() {
  const router = useRouter();
  const [projects, setProjects] = useState<ProjectTracking[] | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState<Candidate | null>(null);
  const [form, setForm] = useState({ wedding_name: "", owner_email: "", owner_phone: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        api<{ items: ProjectTracking[]; count: number }>("/admin/projects"),
        api<{ items: Candidate[] }>("/admin/projects-candidates"),
      ]);
      setProjects(p.items);
      setCandidates(c.items || []);
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Impossible de charger");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = (cand: Candidate) => {
    setForm({
      wedding_name: cand.wedding_name || cand.client_id,
      owner_email: cand.owner_email || "",
      owner_phone: cand.owner_phone || "",
    });
    setCreating(cand);
  };

  const submitCreate = async () => {
    if (!creating) return;
    setSaving(true);
    try {
      await api("/admin/projects", {
        method: "POST",
        body: {
          client_id: creating.client_id,
          wedding_name: form.wedding_name.trim(),
          owner_email: form.owner_email.trim() || null,
          owner_phone: form.owner_phone.trim() || null,
        },
      });
      setCreating(null);
      await load();
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Création impossible");
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} testID="admin-projects-back">
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Suivi de projet</Text>
        <View style={{ width: 26 }} />
      </View>

      {!projects ? (
        <View style={styles.loading}><ActivityIndicator color={colors.gold} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl * 2 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.gold}
            />
          }
        >
          <Text style={styles.sub}>
            Gérez l'avancement des projets de vos clients (9 étapes)
          </Text>

          {/* Existing projects */}
          {projects.length === 0 ? (
            <View style={styles.empty}>
              <Ionicons name="film-outline" size={40} color={colors.textDisabled} />
              <Text style={styles.emptyText}>Aucun projet en cours</Text>
            </View>
          ) : (
            projects.map((p) => (
              <TouchableOpacity
                key={p.client_id}
                style={styles.projectCard}
                onPress={() => router.push(`/admin/projects/${p.client_id}`)}
                testID={`project-item-${p.client_id}`}
              >
                <View style={styles.projectHeader}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.projectTitle}>{p.wedding_name}</Text>
                    <Text style={styles.projectId}>{p.client_id}</Text>
                  </View>
                  <View style={styles.pctBadge}>
                    <Text style={styles.pctText}>{p.progress_percent}%</Text>
                  </View>
                </View>
                <View style={styles.progressTrack}>
                  <LinearGradient
                    colors={["#D4AF37", "#4ADE80"]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 0 }}
                    style={[styles.progressFill, { width: `${Math.max(2, p.progress_percent)}%` }]}
                  />
                </View>
                <View style={styles.projectMeta}>
                  <Text style={styles.metaText}>
                    Étape {p.current_step_index + 1}/{p.steps.length} : {p.steps[p.current_step_index]?.title}
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.gold} />
                </View>
              </TouchableOpacity>
            ))
          )}

          {/* Candidates for new tracking */}
          {candidates.length > 0 && (
            <>
              <Text style={styles.sectionTitle}>Mariages sans suivi actif</Text>
              <Text style={styles.sectionSub}>
                Créez un suivi pour ces mariages détectés (codes / vidéos / claims)
              </Text>
              {candidates.map((c) => (
                <TouchableOpacity
                  key={c.client_id}
                  style={styles.candidateCard}
                  onPress={() => openCreate(c)}
                  testID={`project-candidate-${c.client_id}`}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.candTitle}>{c.wedding_name}</Text>
                    <Text style={styles.candId}>{c.client_id} • source: {c.source || "?"}</Text>
                  </View>
                  <View style={styles.addBadge}>
                    <Ionicons name="add" size={20} color={colors.gold} />
                  </View>
                </TouchableOpacity>
              ))}
            </>
          )}
        </ScrollView>
      )}

      {/* Create modal */}
      <Modal visible={!!creating} transparent animationType="fade" onRequestClose={() => setCreating(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Nouveau suivi</Text>
            <Text style={styles.modalSub}>{creating?.client_id}</Text>

            <Text style={styles.label}>Nom du mariage</Text>
            <TextInput
              style={styles.input}
              value={form.wedding_name}
              onChangeText={(t) => setForm({ ...form, wedding_name: t })}
              placeholder="Hanifa & Dali"
              placeholderTextColor={colors.textDisabled}
              testID="new-project-name"
            />

            <Text style={styles.label}>Email du couple (notifications)</Text>
            <TextInput
              style={styles.input}
              value={form.owner_email}
              onChangeText={(t) => setForm({ ...form, owner_email: t })}
              placeholder="couple@example.com"
              placeholderTextColor={colors.textDisabled}
              autoCapitalize="none"
              keyboardType="email-address"
              testID="new-project-email"
            />

            <Text style={styles.label}>Téléphone (SMS)</Text>
            <TextInput
              style={styles.input}
              value={form.owner_phone}
              onChangeText={(t) => setForm({ ...form, owner_phone: t })}
              placeholder="06XX XX XX XX"
              placeholderTextColor={colors.textDisabled}
              keyboardType="phone-pad"
              testID="new-project-phone"
            />

            <View style={styles.modalActions}>
              <TouchableOpacity
                style={[styles.btn, styles.btnGhost]}
                onPress={() => setCreating(null)}
                disabled={saving}
                testID="new-project-cancel"
              >
                <Text style={styles.btnGhostText}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, styles.btnPrimary]}
                onPress={submitCreate}
                disabled={saving || !form.wedding_name.trim()}
                testID="new-project-create"
              >
                {saving ? (
                  <ActivityIndicator color="#0A0A0A" />
                ) : (
                  <Text style={styles.btnPrimaryText}>Créer</Text>
                )}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    padding: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerTitle: { color: colors.gold, fontSize: 16, fontWeight: "800", letterSpacing: 1 },
  sub: { color: colors.textSecondary, fontSize: 13, marginBottom: spacing.md },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },

  empty: { alignItems: "center", padding: spacing.xl, gap: spacing.sm },
  emptyText: { color: colors.textSecondary, fontSize: 14 },

  projectCard: {
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  projectHeader: { flexDirection: "row", alignItems: "center", marginBottom: spacing.sm },
  projectTitle: { color: colors.ivory, fontSize: 15, fontWeight: "700" },
  projectId: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  pctBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: "rgba(212,175,55,0.15)",
    borderWidth: 1,
    borderColor: colors.gold,
  },
  pctText: { color: colors.gold, fontSize: 12, fontWeight: "800" },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 3 },
  projectMeta: { flexDirection: "row", alignItems: "center", marginTop: spacing.sm },
  metaText: { flex: 1, color: colors.textSecondary, fontSize: 12 },

  sectionTitle: {
    color: colors.ivory,
    fontSize: 14,
    fontWeight: "700",
    marginTop: spacing.lg,
    marginBottom: 2,
  },
  sectionSub: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.md },

  candidateCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: "rgba(255,255,255,0.02)",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.15)",
    borderStyle: "dashed",
    marginBottom: spacing.sm,
  },
  candTitle: { color: colors.ivory, fontSize: 14, fontWeight: "700" },
  candId: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  addBadge: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(212,175,55,0.10)",
    borderWidth: 1,
    borderColor: colors.gold,
    alignItems: "center",
    justifyContent: "center",
  },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
    padding: spacing.md,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: { color: colors.ivory, fontSize: 18, fontWeight: "800" },
  modalSub: { color: colors.textSecondary, fontSize: 12, marginTop: 4, marginBottom: spacing.md },
  label: { color: colors.ivory, fontSize: 12, fontWeight: "700", marginTop: spacing.sm, marginBottom: 6 },
  input: {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.sm,
    padding: 12,
    color: colors.ivory,
    fontSize: 14,
  },
  modalActions: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.lg },
  btn: { flex: 1, paddingVertical: 14, borderRadius: radii.sm, alignItems: "center" },
  btnGhost: { borderWidth: 1, borderColor: colors.border },
  btnGhostText: { color: colors.ivory, fontWeight: "600" },
  btnPrimary: { backgroundColor: colors.gold },
  btnPrimaryText: { color: "#0A0A0A", fontWeight: "800" },
});

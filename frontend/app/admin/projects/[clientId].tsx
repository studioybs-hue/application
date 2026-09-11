import { useCallback, useEffect, useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Modal,
  TextInput,
  RefreshControl,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { colors, spacing, radii } from "@/src/theme";
import {
  ProjectTrackingView,
  type ProjectTracking,
  type ProjectStep,
  type StepStatus,
} from "@/src/features/project-tracking/ProjectTrackingView";

export default function AdminProjectDetail() {
  const { clientId } = useLocalSearchParams<{ clientId: string }>();
  const router = useRouter();
  const [project, setProject] = useState<ProjectTracking | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [editingStep, setEditingStep] = useState<ProjectStep | null>(null);
  const [savingStep, setSavingStep] = useState(false);
  const [notify, setNotify] = useState(true);

  const [editProject, setEditProject] = useState(false);
  const [pForm, setPForm] = useState({ wedding_name: "", owner_email: "", owner_phone: "", admin_note: "", eta_delivery: "" });
  const [savingProject, setSavingProject] = useState(false);

  const load = useCallback(async () => {
    try {
      const p = await api<ProjectTracking>(`/admin/projects/${clientId}`);
      setProject(p);
      setPForm({
        wedding_name: p.wedding_name || "",
        owner_email: p.owner_email || "",
        owner_phone: p.owner_phone || "",
        admin_note: p.admin_note || "",
        eta_delivery: p.eta_delivery || "",
      });
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Projet introuvable");
    } finally {
      setRefreshing(false);
    }
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const updateStepStatus = async (status: StepStatus) => {
    if (!editingStep) return;
    setSavingStep(true);
    try {
      const updated = await api<ProjectTracking>(
        `/admin/projects/${clientId}/steps/${editingStep.key}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status, notify }),
        }
      );
      setProject(updated);
      setEditingStep(null);
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Mise à jour impossible");
    } finally {
      setSavingStep(false);
    }
  };

  const saveProjectEdits = async () => {
    setSavingProject(true);
    try {
      const updated = await api<ProjectTracking>(`/admin/projects/${clientId}`, {
        method: "PATCH",
        body: JSON.stringify({
          wedding_name: pForm.wedding_name.trim() || null,
          owner_email: pForm.owner_email.trim() || null,
          owner_phone: pForm.owner_phone.trim() || null,
          admin_note: pForm.admin_note,
          eta_delivery: pForm.eta_delivery.trim() || null,
        }),
      });
      setProject(updated);
      setEditProject(false);
    } catch (e: any) {
      Alert.alert("Erreur", e?.message || "Enregistrement impossible");
    } finally {
      setSavingProject(false);
    }
  };

  const deleteProject = () => {
    Alert.alert(
      "Supprimer le suivi ?",
      "Cette action est définitive. Le suivi de projet sera supprimé mais les autres données du mariage restent intactes.",
      [
        { text: "Annuler", style: "cancel" },
        {
          text: "Supprimer",
          style: "destructive",
          onPress: async () => {
            try {
              await api(`/admin/projects/${clientId}`, { method: "DELETE" });
              (router.canGoBack() ? router.back() : router.replace("/"));
            } catch (e: any) {
              Alert.alert("Erreur", e?.message || "Suppression impossible");
            }
          },
        },
      ]
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/"))} testID="project-detail-back">
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{project?.wedding_name || clientId}</Text>
        <TouchableOpacity onPress={() => setEditProject(true)} testID="project-edit-btn">
          <Ionicons name="create-outline" size={24} color={colors.gold} />
        </TouchableOpacity>
      </View>

      {!project ? (
        <View style={styles.loading}><ActivityIndicator color={colors.gold} /></View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl * 3 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { setRefreshing(true); load(); }}
              tintColor={colors.gold}
            />
          }
        >
          {/* Contact info */}
          <View style={styles.contactBox}>
            <View style={styles.contactRow}>
              <Ionicons name="mail-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.contactText}>{project.owner_email || "Aucun email"}</Text>
            </View>
            <View style={styles.contactRow}>
              <Ionicons name="call-outline" size={14} color={colors.textSecondary} />
              <Text style={styles.contactText}>{project.owner_phone || "Aucun téléphone"}</Text>
            </View>
          </View>

          {/* Guestbook activation toggle */}
          <TouchableOpacity
            style={[
              styles.guestbookToggle,
              (project as any).is_guestbook_active && styles.guestbookToggleActive,
            ]}
            onPress={async () => {
              try {
                const r = await api<{ is_guestbook_active: boolean }>(
                  `/admin/guestbook/${clientId}/activation`,
                  { method: "PATCH" }
                );
                setProject({ ...project, ...(r as any) } as any);
              } catch (e: any) {
                Alert.alert("Erreur", e?.message);
              }
            }}
            testID="guestbook-toggle"
          >
            <Text style={{ fontSize: 20 }}>💌</Text>
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={styles.guestbookToggleTitle}>Livre d&apos;or numérique</Text>
              <Text style={styles.guestbookToggleSub}>
                {(project as any).is_guestbook_active
                  ? "Actif — les invités peuvent laisser des messages"
                  : "Inactif — cliquez pour activer"}
              </Text>
            </View>
            <View style={[styles.dot, (project as any).is_guestbook_active && { backgroundColor: "#4ADE80" }]} />
          </TouchableOpacity>

          {/* Tracking view */}
          <ProjectTrackingView
            project={project}
            onStepPress={(step) => setEditingStep(step)}
            showHeader={false}
          />

          {/* Delete */}
          <TouchableOpacity style={styles.deleteBtn} onPress={deleteProject} testID="project-delete-btn">
            <Ionicons name="trash-outline" size={16} color={colors.error} />
            <Text style={styles.deleteText}>Supprimer le suivi</Text>
          </TouchableOpacity>
        </ScrollView>
      )}

      {/* Step modal */}
      <Modal visible={!!editingStep} transparent animationType="fade" onRequestClose={() => setEditingStep(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>{editingStep?.title}</Text>
            <Text style={styles.modalSub}>{editingStep?.description}</Text>

            <Text style={styles.stepStatusLabel}>Statut actuel : <Text style={{ color: colors.gold }}>{editingStep?.status}</Text></Text>

            <View style={styles.notifRow}>
              <TouchableOpacity
                onPress={() => setNotify(!notify)}
                style={styles.checkbox}
                testID="notify-toggle"
              >
                <Ionicons
                  name={notify ? "checkbox" : "square-outline"}
                  size={22}
                  color={notify ? colors.gold : colors.textSecondary}
                />
              </TouchableOpacity>
              <Text style={styles.notifText}>Envoyer email + SMS au couple</Text>
            </View>

            <View style={styles.statusButtons}>
              <TouchableOpacity
                style={[styles.statusBtn, styles.pendingBtn]}
                onPress={() => updateStepStatus("pending")}
                disabled={savingStep}
                testID="set-pending"
              >
                <Ionicons name="ellipse-outline" size={18} color={colors.textSecondary} />
                <Text style={styles.pendingBtnText}>À venir</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusBtn, styles.progressBtn]}
                onPress={() => updateStepStatus("in_progress")}
                disabled={savingStep}
                testID="set-in-progress"
              >
                <Ionicons name="time-outline" size={18} color="#0A0A0A" />
                <Text style={styles.progressBtnText}>En cours</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.statusBtn, styles.doneBtn]}
                onPress={() => updateStepStatus("done")}
                disabled={savingStep}
                testID="set-done"
              >
                <Ionicons name="checkmark" size={18} color="#0A0A0A" />
                <Text style={styles.doneBtnText}>Terminée</Text>
              </TouchableOpacity>
            </View>

            {savingStep ? <ActivityIndicator color={colors.gold} style={{ marginTop: spacing.md }} /> : null}

            <TouchableOpacity
              style={styles.cancelBtn}
              onPress={() => setEditingStep(null)}
              disabled={savingStep}
              testID="cancel-step"
            >
              <Text style={styles.cancelBtnText}>Annuler</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Project edit modal */}
      <Modal visible={editProject} transparent animationType="fade" onRequestClose={() => setEditProject(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.modalBackdrop}>
            <ScrollView contentContainerStyle={{ padding: spacing.md }} keyboardShouldPersistTaps="handled">
              <View style={styles.modalCard}>
                <Text style={styles.modalTitle}>Modifier le projet</Text>

                <Text style={styles.label}>Nom du mariage</Text>
                <TextInput
                  style={styles.input}
                  value={pForm.wedding_name}
                  onChangeText={(t) => setPForm({ ...pForm, wedding_name: t })}
                  testID="edit-name"
                />

                <Text style={styles.label}>Email du couple</Text>
                <TextInput
                  style={styles.input}
                  value={pForm.owner_email}
                  onChangeText={(t) => setPForm({ ...pForm, owner_email: t })}
                  placeholder="couple@example.com"
                  placeholderTextColor={colors.textDisabled}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  testID="edit-email"
                />

                <Text style={styles.label}>Téléphone (SMS)</Text>
                <TextInput
                  style={styles.input}
                  value={pForm.owner_phone}
                  onChangeText={(t) => setPForm({ ...pForm, owner_phone: t })}
                  placeholder="06XX XX XX XX"
                  placeholderTextColor={colors.textDisabled}
                  keyboardType="phone-pad"
                  testID="edit-phone"
                />

                <Text style={styles.label}>Date de livraison estimée (ISO ex: 2026-09-15)</Text>
                <TextInput
                  style={styles.input}
                  value={pForm.eta_delivery}
                  onChangeText={(t) => setPForm({ ...pForm, eta_delivery: t })}
                  placeholder="2026-09-15"
                  placeholderTextColor={colors.textDisabled}
                  testID="edit-eta"
                />

                <Text style={styles.label}>Note publique (affichée au couple)</Text>
                <TextInput
                  style={[styles.input, { height: 80, textAlignVertical: "top" }]}
                  value={pForm.admin_note}
                  onChangeText={(t) => setPForm({ ...pForm, admin_note: t })}
                  placeholder="Ex: Sauvegarde en cours, montage lancé bientôt..."
                  placeholderTextColor={colors.textDisabled}
                  multiline
                  numberOfLines={4}
                  testID="edit-note"
                />

                <View style={styles.modalActions}>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnGhost]}
                    onPress={() => setEditProject(false)}
                    disabled={savingProject}
                  >
                    <Text style={styles.btnGhostText}>Annuler</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.btn, styles.btnPrimary]}
                    onPress={saveProjectEdits}
                    disabled={savingProject}
                    testID="save-project"
                  >
                    {savingProject ? (
                      <ActivityIndicator color="#0A0A0A" />
                    ) : (
                      <Text style={styles.btnPrimaryText}>Enregistrer</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
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
    gap: spacing.md,
  },
  headerTitle: {
    flex: 1,
    color: colors.gold,
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },

  contactBox: {
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radii.md,
    marginBottom: spacing.md,
    gap: 6,
  },
  contactRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  contactText: { color: colors.textSecondary, fontSize: 12 },

  guestbookToggle: {
    flexDirection: "row",
    alignItems: "center",
    padding: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
  guestbookToggleActive: {
    borderColor: "#4ADE80",
    backgroundColor: "rgba(74,222,128,0.05)",
  },
  guestbookToggleTitle: { color: colors.ivory, fontSize: 14, fontWeight: "700" },
  guestbookToggleSub: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#3F3F46",
  },

  deleteBtn: {
    marginTop: spacing.xl,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    padding: 12,
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: "rgba(211, 47, 47, 0.4)",
  },
  deleteText: { color: colors.error, fontSize: 13, fontWeight: "600" },

  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.7)",
    justifyContent: "center",
  },
  modalCard: {
    margin: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  modalTitle: { color: colors.ivory, fontSize: 18, fontWeight: "800" },
  modalSub: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  stepStatusLabel: { color: colors.ivory, fontSize: 13, marginTop: spacing.md },

  notifRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: spacing.md,
    padding: 10,
    backgroundColor: "rgba(212,175,55,0.05)",
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.2)",
  },
  checkbox: { marginRight: 8 },
  notifText: { color: colors.ivory, fontSize: 13, flex: 1 },

  statusButtons: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  statusBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    paddingVertical: 12,
    borderRadius: radii.sm,
  },
  pendingBtn: { borderWidth: 1, borderColor: colors.border, backgroundColor: "rgba(255,255,255,0.02)" },
  pendingBtnText: { color: colors.textSecondary, fontWeight: "700", fontSize: 12 },
  progressBtn: { backgroundColor: colors.gold },
  progressBtnText: { color: "#0A0A0A", fontWeight: "800", fontSize: 12 },
  doneBtn: { backgroundColor: "#4ADE80" },
  doneBtnText: { color: "#0A0A0A", fontWeight: "800", fontSize: 12 },

  cancelBtn: { marginTop: spacing.md, padding: 10, alignItems: "center" },
  cancelBtnText: { color: colors.textSecondary, fontSize: 13 },

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

import { useEffect, useState, useCallback } from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Switch,
} from "react-native";
import { useRouter } from "expo-router";
import { SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { api } from "@/src/api/client";
import { showAlert } from "@/src/utils/dialog";
import { useConfirm } from "@/src/ui/ConfirmDialog";
import { colors, spacing, radii } from "@/src/theme";

type Stats = {
  pending: number;
  processing: number;
  processed: number;
  errors: number;
  duplicates: number;
  files_in_drop: number;
  watcher_running: boolean;
  last_scan_at: string | null;
  drop_path: string;
  stable_seconds: number;
};

type Job = {
  id: string;
  filename: string;
  type?: string | null;
  type_label?: string | null;
  couple?: string | null;
  client_name?: string | null;
  service_label?: string | null;
  status: "PENDING" | "PROCESSING" | "PROCESSED" | "ERROR";
  result?: string | null;
  message?: string | null;
  error_message?: string | null;
  created_at: string;
  processed_at?: string | null;
  updated_at: string;
};

type Service = { key: string; label: string; category: string };
type Settings = {
  enabled: boolean;
  default_featured: boolean;
  default_showcase: boolean;
  services: Service[];
  categories: string[];
};

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "PROCESSED", label: "Traités" },
  { key: "PENDING", label: "En attente" },
  { key: "ERROR", label: "Erreurs" },
];

const STATUS_STYLE: Record<Job["status"], { bg: string; fg: string; icon: any; label: string }> = {
  PROCESSED: { bg: "rgba(46,125,50,0.18)", fg: "#6FCF7A", icon: "checkmark-circle", label: "PROCESSED" },
  PENDING: { bg: "rgba(212,175,55,0.15)", fg: colors.gold, icon: "time-outline", label: "PENDING" },
  PROCESSING: { bg: "rgba(212,175,55,0.15)", fg: colors.gold, icon: "sync-outline", label: "PROCESSING" },
  ERROR: { bg: "rgba(211,47,47,0.18)", fg: "#FF7B7B", icon: "alert-circle", label: "ERROR" },
};

function fmtDate(s?: string | null) {
  if (!s) return "—";
  const d = new Date(s);
  return `${d.toLocaleDateString("fr-FR")} ${d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`;
}

export default function AdminAutoImport() {
  const router = useRouter();
  const confirm = useConfirm();
  const [stats, setStats] = useState<Stats | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newCat, setNewCat] = useState("Soirées");
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, j] = await Promise.all([
        api<Stats>("/admin/auto-import/stats"),
        api<{ items: Job[] }>(`/admin/auto-import/jobs?status=${filter}&limit=200`),
      ]);
      setStats(s);
      setJobs(j.items);
      if (!settings) setSettings(await api<Settings>("/admin/auto-import/settings"));
    } catch (e: any) {
      if (e?.status === 401) {
        router.replace("/auth/login");
        return;
      }
      showAlert("Erreur", e?.message || "Impossible de charger l'importation automatique");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, router, settings]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, [load]);

  const scanNow = async () => {
    setScanning(true);
    try {
      const r = await api<{ processed: number; waiting: number }>("/admin/auto-import/scan", { method: "POST" });
      showAlert("Scan terminé", `${r.processed} fichier(s) traité(s) · ${r.waiting} en cours de copie / stabilisation.`);
      await load();
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Scan impossible");
    } finally {
      setScanning(false);
    }
  };

  const retry = async (j: Job) => {
    setBusyId(j.id);
    try {
      await api(`/admin/auto-import/jobs/${j.id}/retry`, { method: "POST" });
      await load();
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Relance impossible");
    } finally {
      setBusyId(null);
    }
  };

  const removeJob = async (j: Job) => {
    const ok = await confirm({
      title: "Retirer du journal ?",
      message: `« ${j.filename} » sera retiré du journal (le fichier n'est pas supprimé).`,
      confirmText: "Retirer",
      destructive: true,
      icon: "trash-outline",
    });
    if (!ok) return;
    try {
      await api(`/admin/auto-import/jobs/${j.id}`, { method: "DELETE" });
      setJobs((prev) => prev.filter((x) => x.id !== j.id));
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Suppression impossible");
    }
  };

  const saveSettings = async (patch: Partial<Settings>) => {
    if (!settings) return;
    const next = { ...settings, ...patch };
    setSettings(next);
    try {
      const saved = await api<Settings>("/admin/auto-import/settings", {
        method: "PUT",
        body: {
          enabled: next.enabled,
          default_featured: next.default_featured,
          default_showcase: next.default_showcase,
          services: next.services.map((s) => ({ key: s.key, label: s.label, category: s.category })),
        },
      });
      setSettings(saved);
    } catch (e: any) {
      showAlert("Erreur", e?.message || "Enregistrement impossible");
      setSettings(settings);
    }
  };

  const addService = () => {
    const key = newKey.trim().toLowerCase();
    if (!key || !settings) return;
    if (settings.services.some((s) => s.key === key)) {
      showAlert("Déjà présente", `La prestation « ${key} » existe déjà.`);
      return;
    }
    const label = newKey.trim().charAt(0).toUpperCase() + newKey.trim().slice(1);
    saveSettings({ services: [...settings.services, { key, label, category: newCat }] });
    setNewKey("");
  };

  const removeService = async (s: Service) => {
    if (!settings) return;
    if (settings.services.length <= 1) {
      showAlert("Impossible", "Au moins une prestation est requise.");
      return;
    }
    const ok = await confirm({
      title: "Retirer la prestation ?",
      message: `« ${s.label} » ne sera plus reconnue dans les noms de fichiers.`,
      confirmText: "Retirer",
      destructive: true,
      icon: "trash-outline",
    });
    if (!ok) return;
    saveSettings({ services: settings.services.filter((x) => x.key !== s.key) });
  };

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => (router.canGoBack() ? router.back() : router.replace("/admin"))} testID="autoimport-back">
          <Ionicons name="chevron-back" size={26} color={colors.ivory} />
        </TouchableOpacity>
        <View>
          <Text style={styles.brand}>IMPORTATION AUTOMATIQUE</Text>
          <Text style={styles.brandSub}>FileZilla → ftp_drop → publication</Text>
        </View>
        <TouchableOpacity onPress={scanNow} disabled={scanning} testID="autoimport-scan">
          {scanning ? <ActivityIndicator color={colors.gold} /> : <Ionicons name="refresh" size={24} color={colors.gold} />}
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.gold} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: spacing.md, paddingBottom: spacing.xl }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                load();
              }}
              tintColor={colors.gold}
            />
          }
        >
          {/* Watcher status */}
          <View style={styles.watcherRow}>
            <View style={[styles.dot, { backgroundColor: stats?.watcher_running ? "#6FCF7A" : colors.error }]} />
            <Text style={styles.watcherTxt} numberOfLines={2}>
              {stats?.watcher_running ? "Surveillance active" : "Surveillance arrêtée"} · {stats?.drop_path}
            </Text>
          </View>
          <Text style={styles.watcherSub}>
            Dernier scan : {fmtDate(stats?.last_scan_at)} · un fichier est traité {stats?.stable_seconds ?? 10}s après la fin de sa copie
          </Text>

          {/* Stats */}
          <View style={styles.statsGrid}>
            <StatCard icon="time-outline" value={(stats?.pending ?? 0) + (stats?.files_in_drop ?? 0)} label="En attente" gold testID="ai-stat-pending" />
            <StatCard icon="checkmark-done-outline" value={stats?.processed ?? 0} label="Traités" testID="ai-stat-processed" />
            <StatCard icon="alert-circle-outline" value={stats?.errors ?? 0} label="Erreurs" error={!!stats?.errors} testID="ai-stat-errors" />
            <StatCard icon="copy-outline" value={stats?.duplicates ?? 0} label="Doublons ignorés" testID="ai-stat-dups" />
          </View>

          {/* Help */}
          <TouchableOpacity style={styles.sectionToggle} onPress={() => setShowHelp((v) => !v)} testID="ai-toggle-help">
            <Ionicons name="document-text-outline" size={18} color={colors.gold} />
            <Text style={styles.sectionToggleTxt}>Nomenclature des fichiers</Text>
            <Ionicons name={showHelp ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          {showHelp && (
            <View style={styles.helpBox}>
              <Text style={styles.helpIntro}>Le nom des mariés en premier, puis le mot-clé :</Text>
              <HelpLine label="Vidéo complète d'une prestation" ex="Yassina & Bensaid video complet Oukoumbi.mp4" />
              <HelpLine label="Vidéo complète du mariage" ex="Yassina & Bensaid video complet.mp4" />
              <HelpLine label="Poster" ex="Yassina & Bensaid Poster.jpg" />
              <HelpLine label="Hero grand format" ex="Yassina & Bensaid Grand format.jpg" />
              <HelpLine label="Bande-annonce (publique)" ex="Yassina & Bensaid bande annonce.mp4" />
              <HelpLine label="Forme courte (prénom + prestation)" ex="yassina Maoulid.mp4  →  prestation Maoulid du mariage contenant « yassina »" />
              <Text style={styles.helpIntro}>Ancienne forme également acceptée :</Text>
              <HelpLine label="Prestation" ex="Mariage de Sofie & Mohamed Oukoumbi soiree.mp4" />
              <HelpLine label="Vidéo complète / Poster / Hero / Bande-annonce" ex="Video complete : Sofie & Mohamed.mp4 · Poster : Portrait Sofie.jpg" />
              <Text style={styles.helpNote}>
                Casse, accents et petites fautes de frappe tolérés · « & » = « et » · Vidéos : .mp4 .mov .mkv · Images : .jpg .jpeg .png .webp · Une prestation inconnue (ex. Oukoumbi) est ajoutée automatiquement à la liste · Fichiers invalides → ftp_drop/errors, doublons → ftp_drop/duplicates.
              </Text>
            </View>
          )}

          {/* Settings */}
          <TouchableOpacity style={styles.sectionToggle} onPress={() => setShowSettings((v) => !v)} testID="ai-toggle-settings">
            <Ionicons name="options-outline" size={18} color={colors.gold} />
            <Text style={styles.sectionToggleTxt}>Prestations & publication</Text>
            <Ionicons name={showSettings ? "chevron-up" : "chevron-down"} size={18} color={colors.textSecondary} />
          </TouchableOpacity>
          {showSettings && settings && (
            <View style={styles.helpBox}>
              <View style={styles.switchRow}>
                <Text style={styles.label}>Importation automatique activée</Text>
                <Switch value={settings.enabled} onValueChange={(v) => saveSettings({ enabled: v })} trackColor={{ true: colors.gold }} testID="ai-switch-enabled" />
              </View>
              <View style={styles.switchRow}>
                <Text style={styles.label}>Nouveau mariage → À l&apos;affiche</Text>
                <Switch value={settings.default_featured} onValueChange={(v) => saveSettings({ default_featured: v })} trackColor={{ true: colors.gold }} testID="ai-switch-featured" />
              </View>
              <View style={styles.switchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.label}>Nouveau mariage → Démo publique</Text>
                  <Text style={styles.hint}>Visible dans « Découvrir », regardable avec un compte gratuit sans code</Text>
                </View>
                <Switch value={settings.default_showcase} onValueChange={(v) => saveSettings({ default_showcase: v })} trackColor={{ true: colors.gold }} testID="ai-switch-showcase" />
              </View>

              <Text style={[styles.label, { marginTop: spacing.md, marginBottom: 6 }]}>Prestations reconnues (fin du nom de fichier)</Text>
              <View style={styles.chips}>
                {settings.services.map((s) => (
                  <View key={s.key} style={styles.serviceChip} testID={`ai-service-${s.key}`}>
                    <Text style={styles.serviceKey}>{s.key}</Text>
                    <Text style={styles.serviceCat}>· {s.category}</Text>
                    <TouchableOpacity onPress={() => removeService(s)} hitSlop={8} testID={`ai-service-remove-${s.key}`}>
                      <Ionicons name="close-circle" size={16} color={colors.textSecondary} />
                    </TouchableOpacity>
                  </View>
                ))}
              </View>
              <View style={styles.addRow}>
                <TextInput
                  style={[styles.input, { flex: 1 }]}
                  value={newKey}
                  onChangeText={setNewKey}
                  placeholder="Nouvelle prestation (ex: brunch)"
                  placeholderTextColor={colors.textDisabled}
                  autoCapitalize="none"
                  onSubmitEditing={addService}
                  testID="ai-service-input"
                />
                <TouchableOpacity style={styles.addBtn} onPress={addService} testID="ai-service-add">
                  <Ionicons name="add" size={20} color="#0A0A0A" />
                </TouchableOpacity>
              </View>
              <View style={styles.chips}>
                {settings.categories.filter((c) => c !== "À l'affiche").map((c) => (
                  <TouchableOpacity key={c} style={[styles.catChip, newCat === c && styles.catChipActive]} onPress={() => setNewCat(c)} testID={`ai-cat-${c}`}>
                    <Text style={[styles.catChipTxt, newCat === c && { color: "#0A0A0A", fontWeight: "700" }]}>{c}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {/* Journal */}
          <Text style={styles.h2}>Journal d&apos;importation</Text>
          <View style={styles.chips}>
            {FILTERS.map((f) => (
              <TouchableOpacity key={f.key} style={[styles.catChip, filter === f.key && styles.catChipActive]} onPress={() => setFilter(f.key)} testID={`ai-filter-${f.key}`}>
                <Text style={[styles.catChipTxt, filter === f.key && { color: "#0A0A0A", fontWeight: "700" }]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </View>

          {jobs.length === 0 ? (
            <Text style={styles.empty}>Aucun fichier importé pour le moment. Déposez vos fichiers dans ftp_drop via FileZilla.</Text>
          ) : (
            jobs.map((j) => {
              const st = STATUS_STYLE[j.status] || STATUS_STYLE.PENDING;
              const isDup = j.result === "duplicate";
              return (
                <View key={j.id} style={styles.jobCard} testID={`ai-job-${j.id}`}>
                  <View style={styles.jobTop}>
                    <Ionicons name={j.type === "poster" || j.type === "hero" ? "image-outline" : "film-outline"} size={18} color={colors.gold} />
                    <Text style={styles.jobFile} numberOfLines={2}>{j.filename}</Text>
                    <View style={[styles.badge, { backgroundColor: st.bg }]}>
                      <Ionicons name={st.icon} size={12} color={st.fg} />
                      <Text style={[styles.badgeTxt, { color: st.fg }]}>{isDup ? "DOUBLON" : st.label}</Text>
                    </View>
                  </View>
                  <View style={styles.jobMeta}>
                    <Meta label="Type" value={j.type_label || "—"} />
                    <Meta label="Mariage" value={j.client_name || j.couple || "—"} />
                    <Meta label="Prestation" value={j.service_label || "—"} />
                    <Meta label="Date" value={fmtDate(j.processed_at || j.updated_at)} />
                  </View>
                  {!!(j.error_message || j.message) && (
                    <Text style={[styles.jobMsg, j.status === "ERROR" && { color: "#FF7B7B" }]}>
                      {j.error_message || j.message}
                    </Text>
                  )}
                  <View style={styles.jobActions}>
                    {(j.status === "ERROR" || j.status === "PENDING") && (
                      <TouchableOpacity style={styles.smallBtn} onPress={() => retry(j)} disabled={busyId === j.id} testID={`ai-retry-${j.id}`}>
                        {busyId === j.id ? <ActivityIndicator color={colors.gold} size="small" /> : <Ionicons name="refresh" size={14} color={colors.gold} />}
                        <Text style={styles.smallBtnTxt}>Relancer</Text>
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={[styles.smallBtn, { borderColor: "rgba(255,255,255,0.15)" }]} onPress={() => removeJob(j)} testID={`ai-delete-${j.id}`}>
                      <Ionicons name="trash-outline" size={14} color={colors.textSecondary} />
                      <Text style={[styles.smallBtnTxt, { color: colors.textSecondary }]}>Retirer</Text>
                    </TouchableOpacity>
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function StatCard({ icon, value, label, gold, error, testID }: { icon: any; value: number; label: string; gold?: boolean; error?: boolean; testID: string }) {
  const color = error ? "#FF7B7B" : gold ? colors.gold : colors.ivory;
  return (
    <View style={[styles.statCard, gold && { borderColor: colors.gold }, error && { borderColor: "rgba(211,47,47,0.5)" }]} testID={testID}>
      <Ionicons name={icon} size={20} color={color} />
      <Text style={[styles.statValue, { color }]}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function HelpLine({ label, ex }: { label: string; ex: string }) {
  return (
    <View style={{ marginBottom: 8 }}>
      <Text style={styles.helpLabel}>{label}</Text>
      <Text style={styles.helpEx}>{ex}</Text>
    </View>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.meta}>
      <Text style={styles.metaLabel}>{label}</Text>
      <Text style={styles.metaValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  brand: { color: colors.gold, fontSize: 14, fontWeight: "700", letterSpacing: 2, textAlign: "center" },
  brandSub: { color: colors.textSecondary, fontSize: 10, letterSpacing: 1, textAlign: "center" },
  h2: { color: colors.ivory, fontSize: 18, fontWeight: "700", marginTop: spacing.lg, marginBottom: spacing.sm },
  watcherRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  watcherTxt: { color: colors.ivory, fontSize: 13, flex: 1 },
  watcherSub: { color: colors.textSecondary, fontSize: 11, marginTop: 4, marginBottom: spacing.md },
  statsGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginBottom: spacing.md },
  statCard: { width: "48%", flexGrow: 1, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  statValue: { fontSize: 26, fontWeight: "700", marginTop: 6 },
  statLabel: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },
  sectionToggle: { flexDirection: "row", alignItems: "center", gap: 10, backgroundColor: colors.surface, padding: spacing.md, borderRadius: radii.md, borderWidth: 1, borderColor: "rgba(212,175,55,0.12)", marginTop: spacing.sm },
  sectionToggleTxt: { flex: 1, color: colors.ivory, fontSize: 15, fontWeight: "600" },
  helpBox: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginTop: 6, borderWidth: 1, borderColor: "rgba(255,255,255,0.06)" },
  helpLabel: { color: colors.gold, fontSize: 12, fontWeight: "700" },
  helpIntro: { color: colors.textSecondary, fontSize: 12, marginBottom: 6, marginTop: 4 },
  helpEx: { color: colors.ivory, fontSize: 13, fontFamily: "monospace" as any },
  helpNote: { color: colors.textSecondary, fontSize: 11, marginTop: 6, lineHeight: 16 },
  switchRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 8, gap: spacing.md },
  label: { color: colors.ivory, fontSize: 14, fontWeight: "600" },
  hint: { color: colors.textSecondary, fontSize: 11, marginTop: 2 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: spacing.sm },
  serviceChip: { flexDirection: "row", alignItems: "center", gap: 4, paddingVertical: 6, paddingHorizontal: 10, borderRadius: 16, borderWidth: 1, borderColor: colors.border, backgroundColor: "rgba(212,175,55,0.06)" },
  serviceKey: { color: colors.gold, fontSize: 13, fontWeight: "700" },
  serviceCat: { color: colors.textSecondary, fontSize: 11 },
  addRow: { flexDirection: "row", gap: 8, alignItems: "center", marginBottom: spacing.sm },
  input: { backgroundColor: colors.surfaceElevated, color: colors.ivory, borderRadius: radii.sm, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: colors.border, fontSize: 14, minHeight: 44 },
  addBtn: { backgroundColor: colors.gold, width: 44, height: 44, borderRadius: radii.sm, alignItems: "center", justifyContent: "center" },
  catChip: { paddingVertical: 8, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: colors.border, minHeight: 36, justifyContent: "center" },
  catChipActive: { backgroundColor: colors.gold, borderColor: colors.gold },
  catChipTxt: { color: colors.ivory, fontSize: 12 },
  empty: { color: colors.textSecondary, fontStyle: "italic", textAlign: "center", padding: spacing.md },
  jobCard: { backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.sm, borderWidth: 1, borderColor: "rgba(212,175,55,0.12)" },
  jobTop: { flexDirection: "row", alignItems: "center", gap: 8 },
  jobFile: { flex: 1, color: colors.ivory, fontSize: 13, fontWeight: "600" },
  badge: { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6 },
  badgeTxt: { fontSize: 10, fontWeight: "700", letterSpacing: 0.5 },
  jobMeta: { flexDirection: "row", flexWrap: "wrap", marginTop: 10, gap: 8 },
  meta: { minWidth: "45%", flexGrow: 1 },
  metaLabel: { color: colors.textSecondary, fontSize: 10, textTransform: "uppercase", letterSpacing: 0.5 },
  metaValue: { color: colors.ivory, fontSize: 13, marginTop: 1 },
  jobMsg: { color: colors.textSecondary, fontSize: 12, marginTop: 8, lineHeight: 16 },
  jobActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  smallBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 8, paddingHorizontal: 12, borderRadius: radii.sm, borderWidth: 1, borderColor: colors.gold, minHeight: 36 },
  smallBtnTxt: { color: colors.gold, fontSize: 12, fontWeight: "600" },
});

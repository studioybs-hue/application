/**
 * Project Tracking display component — used by both client (Profile) and admin (detail).
 *
 * Renders the 9-step wedding project workflow with the same look & feel as
 * creativindustry.com/suivi-projet:
 *   - Progress bar (yellow → green gradient)
 *   - Step cards in 3 states: pending (grey), in_progress (gold), done (green)
 *   - Optional admin note bubble
 *   - Optional ETA line
 *
 * If `onStepPress` is provided → the card becomes touchable (admin mode).
 */
import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radii } from "@/src/theme";

export type StepStatus = "pending" | "in_progress" | "done";

export type ProjectStep = {
  key: string;
  title: string;
  description: string;
  status: StepStatus;
  started_at?: string | null;
  completed_at?: string | null;
  notified_at?: string | null;
};

export type ProjectTracking = {
  id: string;
  client_id: string;
  wedding_name: string;
  owner_email?: string | null;
  owner_phone?: string | null;
  admin_note?: string;
  eta_delivery?: string | null;
  steps: ProjectStep[];
  current_step_index: number;
  progress_percent: number;
  deliverables?: import("./deliverables").Deliverables;
};

export type StepAction = {
  label: string;
  icon: string;
  onPress: () => void;
  hint?: string;      // texte d'état sous le bouton (ex. « Sélection envoyée le 12 sept. »)
  secondary?: boolean; // style discret (déjà fait)
  testID?: string;
};

type Props = {
  project: ProjectTracking;
  onStepPress?: (step: ProjectStep) => void;
  compact?: boolean;
  showHeader?: boolean;
  /** Actions concrètes proposées aux mariés sous certaines étapes (clé d'étape → action). */
  stepActions?: Record<string, StepAction | StepAction[] | undefined>;
};

const STATUS_COLORS: Record<StepStatus, { border: string; bg: string; icon: string; iconColor: string; title: string; badge: string; badgeBg: string; badgeText: string; }> = {
  done: {
    border: "#2E7D32",
    bg: "rgba(46,125,50,0.10)",
    icon: "checkmark",
    iconColor: "#0A0A0A",
    title: "#4ADE80",
    badge: "#1B5E20",
    badgeBg: "rgba(46,125,50,0.20)",
    badgeText: "#86EFAC",
  },
  in_progress: {
    border: "#D4AF37",
    bg: "rgba(212,175,55,0.10)",
    icon: "time-outline",
    iconColor: "#0A0A0A",
    title: "#FFFFF0",
    badge: "#7C5E00",
    badgeBg: "rgba(212,175,55,0.20)",
    badgeText: "#FCD34D",
  },
  pending: {
    border: "rgba(255,255,255,0.10)",
    bg: "rgba(255,255,255,0.02)",
    icon: "ellipse-outline",
    iconColor: "#52525B",
    title: "#A1A1AA",
    badge: "#3F3F46",
    badgeBg: "rgba(120,120,120,0.15)",
    badgeText: "#A1A1AA",
  },
};

function fmtDate(iso?: string | null): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

const STATUS_LABELS: Record<StepStatus, string> = {
  done: "Terminé",
  in_progress: "En cours",
  pending: "À venir",
};

export function ProjectTrackingView({ project, onStepPress, compact = false, showHeader = true, stepActions }: Props) {
  const isDone = project.progress_percent >= 100;

  return (
    <View>
      {showHeader && (
        <View style={styles.header}>
          <Ionicons name="film-outline" size={22} color={colors.gold} />
          <View style={{ marginLeft: spacing.sm, flex: 1 }}>
            <Text style={styles.headerTitle}>Suivi de votre film</Text>
            <Text style={styles.headerSub} testID="project-progress-label">
              {isDone
                ? "Toutes les étapes sont complétées 🎉"
                : `Étape ${project.current_step_index + 1} sur ${project.steps.length} • ${project.progress_percent}%`}
            </Text>
          </View>
        </View>
      )}

      {/* Progress bar */}
      <View style={styles.progressWrap} testID="project-progress-bar">
        <View style={styles.progressTrack}>
          <LinearGradient
            colors={["#D4AF37", "#4ADE80"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
            style={[styles.progressFill, { width: `${Math.max(2, project.progress_percent)}%` }]}
          />
        </View>
        <Text style={styles.progressText}>{project.progress_percent}%</Text>
      </View>

      {/* ETA */}
      {project.eta_delivery ? (
        <View style={styles.etaRow}>
          <Ionicons name="calendar-outline" size={14} color={colors.gold} />
          <Text style={styles.etaText}>
            Livraison estimée : <Text style={{ color: colors.ivory }}>{fmtDate(project.eta_delivery)}</Text>
          </Text>
        </View>
      ) : null}

      {/* Steps */}
      <View style={{ marginTop: spacing.md }}>
        {onStepPress ? (
          <Text style={styles.helpText}>Cliquez sur une étape pour la mettre à jour</Text>
        ) : null}
        {project.steps.map((step, index) => {
          const s = STATUS_COLORS[step.status];
          const raw = stepActions?.[step.key];
          const actions: StepAction[] = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
          const body = (
            <View style={[styles.stepCard, { borderColor: s.border, backgroundColor: s.bg }]}>
              <View style={styles.stepRow}>
                <View style={[styles.stepIcon, { backgroundColor: step.status === "pending" ? "transparent" : (step.status === "done" ? "#4ADE80" : "#D4AF37") }]}>
                  <Ionicons name={s.icon as any} size={20} color={s.iconColor} />
                </View>
                <View style={{ flex: 1, marginLeft: spacing.md }}>
                  <Text style={[styles.stepTitle, { color: s.title }]}>{step.title}</Text>
                  <Text style={styles.stepDesc} numberOfLines={compact ? 1 : 3}>
                    {step.description}
                  </Text>
                  {step.completed_at && step.status === "done" ? (
                    <Text style={styles.stepDate}>Terminée le {fmtDate(step.completed_at)}</Text>
                  ) : null}
                </View>
                <View style={[styles.badge, { backgroundColor: s.badgeBg, borderColor: s.badge }]}>
                  <Text style={[styles.badgeText, { color: s.badgeText }]}>
                    {STATUS_LABELS[step.status]}
                  </Text>
                </View>
                {onStepPress && (
                  <Ionicons name="chevron-forward" size={18} color={s.badgeText} style={{ marginLeft: 6 }} />
                )}
              </View>
              {actions.length ? (
                <View style={styles.actionWrap}>
                  {actions.map((action, ai) => (
                    <View key={ai} style={ai > 0 ? { marginTop: 8 } : undefined}>
                      <TouchableOpacity
                        style={[styles.actionBtn, action.secondary && styles.actionBtnSecondary]}
                        onPress={action.onPress}
                        activeOpacity={0.8}
                        testID={action.testID || (ai === 0 ? `project-step-action-${step.key}` : `project-step-action-${step.key}-${ai}`)}
                      >
                        <Ionicons name={action.icon as any} size={16} color={action.secondary ? colors.gold : "#0A0A0A"} />
                        <Text style={[styles.actionTxt, action.secondary && { color: colors.gold }]}>{action.label}</Text>
                      </TouchableOpacity>
                      {action.hint ? <Text style={styles.actionHint}>{action.hint}</Text> : null}
                    </View>
                  ))}
                </View>
              ) : null}
            </View>
          );
          return onStepPress ? (
            <TouchableOpacity
              key={step.key}
              onPress={() => onStepPress(step)}
              activeOpacity={0.7}
              testID={`project-step-${step.key}`}
            >
              {body}
            </TouchableOpacity>
          ) : (
            <View key={step.key} testID={`project-step-${step.key}`}>{body}</View>
          );
        })}
      </View>

      {/* Admin note */}
      {project.admin_note ? (
        <View style={styles.noteBox} testID="project-admin-note">
          <View style={styles.noteHeader}>
            <Ionicons name="chatbubble-ellipses-outline" size={16} color={colors.gold} />
            <Text style={styles.noteHeaderText}>Message du studio</Text>
          </View>
          <Text style={styles.noteText}>{project.admin_note}</Text>
        </View>
      ) : null}

      {/* Final banner */}
      {isDone ? (
        <View style={styles.doneBanner} testID="project-done-banner">
          <Ionicons name="checkmark-circle" size={28} color="#4ADE80" />
          <Text style={styles.doneTitle}>🎉 Projet terminé !</Text>
          <Text style={styles.doneSub}>Toutes les étapes sont complétées</Text>
        </View>
      ) : null}
    </View>
  );
}

export function ProjectTrackingLoading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={colors.gold} />
    </View>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: "row", alignItems: "center", marginBottom: spacing.md },
  headerTitle: { color: colors.ivory, fontSize: 16, fontWeight: "700" },
  headerSub: { color: colors.textSecondary, fontSize: 12, marginTop: 2 },

  progressWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  progressTrack: {
    flex: 1,
    height: 10,
    borderRadius: 5,
    backgroundColor: "rgba(255,255,255,0.06)",
    overflow: "hidden",
  },
  progressFill: { height: "100%", borderRadius: 5 },
  progressText: { color: colors.gold, fontWeight: "800", fontSize: 14, minWidth: 44, textAlign: "right" },

  etaRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: spacing.sm },
  etaText: { color: colors.textSecondary, fontSize: 12 },

  helpText: { color: colors.textSecondary, fontSize: 12, marginBottom: spacing.sm },

  stepCard: {
    padding: spacing.md,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.sm,
  },
  stepRow: { flexDirection: "row", alignItems: "center" },
  actionWrap: { marginTop: spacing.sm, marginLeft: 40 + spacing.md },
  actionBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    alignSelf: "flex-start",
    minHeight: 44,
    paddingHorizontal: spacing.md,
    borderRadius: radii.sm,
    backgroundColor: colors.gold,
  },
  actionBtnSecondary: { backgroundColor: "rgba(212,175,55,0.10)", borderWidth: 1, borderColor: "rgba(212,175,55,0.45)" },
  actionTxt: { color: "#0A0A0A", fontWeight: "800", fontSize: 13 },
  actionHint: { color: colors.textSecondary, fontSize: 11, marginTop: 6, fontStyle: "italic" },
  stepIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  stepTitle: { fontSize: 15, fontWeight: "700", marginBottom: 2 },
  stepDesc: { color: colors.textSecondary, fontSize: 12, lineHeight: 16 },
  stepDate: { color: colors.textSecondary, fontSize: 11, marginTop: 4, fontStyle: "italic" },

  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    marginLeft: spacing.sm,
  },
  badgeText: { fontSize: 11, fontWeight: "700" },

  noteBox: {
    marginTop: spacing.md,
    padding: spacing.md,
    backgroundColor: "rgba(212,175,55,0.08)",
    borderWidth: 1,
    borderColor: "rgba(212,175,55,0.25)",
    borderRadius: radii.md,
  },
  noteHeader: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  noteHeaderText: { color: colors.gold, fontSize: 12, fontWeight: "700", textTransform: "uppercase", letterSpacing: 0.5 },
  noteText: { color: colors.ivory, fontSize: 13, lineHeight: 18 },

  doneBanner: {
    marginTop: spacing.md,
    padding: spacing.lg,
    alignItems: "center",
    backgroundColor: "rgba(46,125,50,0.10)",
    borderWidth: 1,
    borderColor: "#4ADE80",
    borderRadius: radii.md,
  },
  doneTitle: { color: "#4ADE80", fontSize: 18, fontWeight: "800", marginTop: 6 },
  doneSub: { color: "#9AE6B4", fontSize: 12, marginTop: 4 },

  loading: { padding: spacing.lg, alignItems: "center" },
});

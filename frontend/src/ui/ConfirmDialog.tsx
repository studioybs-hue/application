import React, { useState, useCallback, useMemo, useEffect } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radii } from "@/src/theme";

type ConfirmOptions = {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
};

type AlertOptions = {
  title: string;
  message?: string;
  buttonText?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  variant?: "info" | "success" | "warning" | "danger";
};

type Ctx = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  alert: (opts: AlertOptions) => Promise<void>;
};

const ConfirmContext = React.createContext<Ctx | null>(null);

// ============================================================
// MODULE-LEVEL singletons so utilities (showAlert/confirmAction)
// can trigger the branded dialog without going through React hooks.
// ============================================================
let _globalConfirm: ((opts: ConfirmOptions) => Promise<boolean>) | null = null;
let _globalAlert: ((opts: AlertOptions) => Promise<void>) | null = null;

export function globalConfirm(opts: ConfirmOptions): Promise<boolean> {
  if (_globalConfirm) return _globalConfirm(opts);
  return Promise.resolve(false);
}

export function globalAlert(opts: AlertOptions): Promise<void> {
  if (_globalAlert) return _globalAlert(opts);
  return Promise.resolve();
}

type ConfirmState = ConfirmOptions & { open: boolean; resolver?: (v: boolean) => void };
type AlertState = AlertOptions & { open: boolean; resolver?: () => void };

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [confState, setConfState] = useState<ConfirmState>({ open: false, title: "" });
  const [alertState, setAlertState] = useState<AlertState>({ open: false, title: "" });

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setConfState({ ...opts, open: true, resolver: resolve });
    });
  }, []);

  const alert = useCallback((opts: AlertOptions) => {
    return new Promise<void>((resolve) => {
      setAlertState({ ...opts, open: true, resolver: resolve });
    });
  }, []);

  // Register globally so non-React utilities can call them
  useEffect(() => {
    _globalConfirm = confirm;
    _globalAlert = alert;
    return () => {
      _globalConfirm = null;
      _globalAlert = null;
    };
  }, [confirm, alert]);

  const closeConf = (v: boolean) => {
    confState.resolver?.(v);
    setConfState((s) => ({ ...s, open: false, resolver: undefined }));
  };
  const closeAlert = () => {
    alertState.resolver?.();
    setAlertState((s) => ({ ...s, open: false, resolver: undefined }));
  };

  const value = useMemo(() => ({ confirm, alert }), [confirm, alert]);

  // Alert color mapping
  const variantColors = {
    info: { bg: "rgba(212,175,55,0.12)", border: colors.gold, fg: colors.gold, defaultIcon: "information-circle-outline" as const },
    success: { bg: "rgba(58,218,106,0.12)", border: "#3ada6a", fg: "#3ada6a", defaultIcon: "checkmark-circle" as const },
    warning: { bg: "rgba(255,165,0,0.12)", border: "#ffa500", fg: "#ffa500", defaultIcon: "warning-outline" as const },
    danger: { bg: "rgba(211,47,47,0.12)", border: colors.error, fg: colors.error, defaultIcon: "alert-circle" as const },
  };
  const aVariant = alertState.variant || "info";
  const aCol = variantColors[aVariant];

  return (
    <ConfirmContext.Provider value={value}>
      {children}

      {/* ========== CONFIRM DIALOG ========== */}
      <Modal
        visible={confState.open}
        transparent
        animationType="fade"
        onRequestClose={() => closeConf(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.card} testID="confirm-dialog">
            <View style={[styles.iconCircle, confState.destructive && styles.iconCircleDanger]}>
              <Ionicons
                name={confState.icon || (confState.destructive ? "trash-outline" : "alert-circle-outline")}
                size={32}
                color={confState.destructive ? colors.error : colors.gold}
              />
            </View>
            <Text style={styles.title}>{confState.title}</Text>
            {confState.message ? (
              <ScrollView style={styles.scrollMsg} contentContainerStyle={{ flexGrow: 1 }}>
                <Text style={styles.message}>{confState.message}</Text>
              </ScrollView>
            ) : null}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn]}
                onPress={() => closeConf(false)}
                testID="confirm-cancel"
              >
                <Text style={styles.cancelTxt}>{confState.cancelText || "Annuler"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, confState.destructive ? styles.dangerBtn : styles.confirmBtn]}
                onPress={() => closeConf(true)}
                testID="confirm-ok"
              >
                <Text style={confState.destructive ? styles.dangerTxt : styles.confirmTxt}>
                  {confState.confirmText || "Confirmer"}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ========== ALERT DIALOG ========== */}
      <Modal
        visible={alertState.open}
        transparent
        animationType="fade"
        onRequestClose={closeAlert}
      >
        <View style={styles.backdrop}>
          <View style={styles.card} testID="alert-dialog">
            <View style={[styles.iconCircle, { backgroundColor: aCol.bg, borderColor: aCol.border }]}>
              <Ionicons name={alertState.icon || aCol.defaultIcon} size={32} color={aCol.fg} />
            </View>
            <Text style={styles.title}>{alertState.title}</Text>
            {alertState.message ? (
              <ScrollView style={styles.scrollMsg} contentContainerStyle={{ flexGrow: 1 }}>
                <Text style={styles.message}>{alertState.message}</Text>
              </ScrollView>
            ) : null}
            <View style={[styles.actions, { flexDirection: "column" }]}>
              <TouchableOpacity
                style={[styles.btn, styles.confirmBtn, { width: "100%" }]}
                onPress={closeAlert}
                testID="alert-ok"
              >
                <Text style={styles.confirmTxt}>{alertState.buttonText || "OK"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx.confirm;
}

export function useAlertDialog() {
  const ctx = React.useContext(ConfirmContext);
  if (!ctx) throw new Error("useAlertDialog must be used within ConfirmProvider");
  return ctx.alert;
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.8)",
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  card: {
    width: "100%",
    maxWidth: 400,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    padding: spacing.lg,
    alignItems: "center",
    borderWidth: 1,
    borderColor: colors.border,
  },
  iconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(212,175,55,0.12)",
    borderWidth: 1.5,
    borderColor: colors.gold,
    marginBottom: spacing.md,
  },
  iconCircleDanger: { backgroundColor: "rgba(211,47,47,0.12)", borderColor: colors.error },
  title: { color: colors.ivory, fontSize: 20, fontWeight: "700", textAlign: "center" },
  scrollMsg: { maxHeight: 240, width: "100%", marginTop: 8 },
  message: { color: colors.textSecondary, fontSize: 14, textAlign: "center", lineHeight: 20, paddingHorizontal: 4 },
  actions: { flexDirection: "row", gap: 10, marginTop: spacing.lg, width: "100%" },
  btn: { flex: 1, paddingVertical: 14, borderRadius: radii.sm, alignItems: "center" },
  cancelBtn: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
  cancelTxt: { color: colors.ivory, fontWeight: "600", fontSize: 14 },
  confirmBtn: { backgroundColor: colors.gold },
  confirmTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 14 },
  dangerBtn: { backgroundColor: colors.error },
  dangerTxt: { color: "#FFFFF0", fontWeight: "700", fontSize: 14 },
});

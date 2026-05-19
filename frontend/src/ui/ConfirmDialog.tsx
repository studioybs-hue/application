import React, { useState, useCallback, useMemo } from "react";
import { Modal, View, Text, TouchableOpacity, StyleSheet, ActivityIndicator } from "react-native";
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

type Ctx = {
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
};

const ConfirmContext = React.createContext<Ctx | null>(null);

type State = ConfirmOptions & { open: boolean; resolver?: (v: boolean) => void; loading?: boolean };

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<State>({ open: false, title: "" });

  const confirm = useCallback((opts: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setState({ ...opts, open: true, resolver: resolve, loading: false });
    });
  }, []);

  const close = (v: boolean) => {
    state.resolver?.(v);
    setState((s) => ({ ...s, open: false, resolver: undefined }));
  };

  const value = useMemo(() => ({ confirm }), [confirm]);

  return (
    <ConfirmContext.Provider value={value}>
      {children}
      <Modal
        visible={state.open}
        transparent
        animationType="fade"
        onRequestClose={() => close(false)}
      >
        <View style={styles.backdrop}>
          <View style={styles.card} testID="confirm-dialog">
            <View style={[styles.iconCircle, state.destructive && styles.iconCircleDanger]}>
              <Ionicons
                name={state.icon || (state.destructive ? "trash-outline" : "alert-circle-outline")}
                size={32}
                color={state.destructive ? colors.error : colors.gold}
              />
            </View>
            <Text style={styles.title}>{state.title}</Text>
            {state.message ? <Text style={styles.message}>{state.message}</Text> : null}
            <View style={styles.actions}>
              <TouchableOpacity
                style={[styles.btn, styles.cancelBtn]}
                onPress={() => close(false)}
                testID="confirm-cancel"
              >
                <Text style={styles.cancelTxt}>{state.cancelText || "Annuler"}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btn, state.destructive ? styles.dangerBtn : styles.confirmBtn]}
                onPress={() => close(true)}
                testID="confirm-ok"
              >
                <Text style={state.destructive ? styles.dangerTxt : styles.confirmTxt}>
                  {state.confirmText || "Confirmer"}
                </Text>
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

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.8)", alignItems: "center", justifyContent: "center", padding: spacing.lg },
  card: { width: "100%", maxWidth: 380, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, alignItems: "center", borderWidth: 1, borderColor: colors.border },
  iconCircle: { width: 64, height: 64, borderRadius: 32, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(212,175,55,0.12)", borderWidth: 1.5, borderColor: colors.gold, marginBottom: spacing.md },
  iconCircleDanger: { backgroundColor: "rgba(211,47,47,0.12)", borderColor: colors.error },
  title: { color: colors.ivory, fontSize: 20, fontWeight: "700", textAlign: "center" },
  message: { color: colors.textSecondary, fontSize: 14, textAlign: "center", marginTop: 8, lineHeight: 20 },
  actions: { flexDirection: "row", gap: 10, marginTop: spacing.lg, width: "100%" },
  btn: { flex: 1, paddingVertical: 14, borderRadius: radii.sm, alignItems: "center" },
  cancelBtn: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.border },
  cancelTxt: { color: colors.ivory, fontWeight: "600", fontSize: 14 },
  confirmBtn: { backgroundColor: colors.gold },
  confirmTxt: { color: "#0A0A0A", fontWeight: "700", fontSize: 14 },
  dangerBtn: { backgroundColor: colors.error },
  dangerTxt: { color: "#FFFFF0", fontWeight: "700", fontSize: 14 },
});

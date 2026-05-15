import { Alert, Platform } from "react-native";

/**
 * Cross-platform confirm dialog.
 * On web: uses window.confirm (Alert.alert buttons don't work on RNW).
 * On native: uses Alert.alert with proper Cancel/Confirm buttons.
 */
export function confirmAction(
  title: string,
  message: string,
  onConfirm: () => void | Promise<void>,
  options?: { confirmText?: string; cancelText?: string; destructive?: boolean }
) {
  const confirmText = options?.confirmText || "Confirmer";
  const cancelText = options?.cancelText || "Annuler";
  if (Platform.OS === "web") {
    const ok = typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`);
    if (ok) onConfirm();
    return;
  }
  Alert.alert(title, message, [
    { text: cancelText, style: "cancel" },
    { text: confirmText, style: options?.destructive ? "destructive" : "default", onPress: () => { onConfirm(); } },
  ]);
}

/**
 * Cross-platform alert (info message).
 * Works on web by using window.alert as fallback.
 */
export function showAlert(title: string, message: string, onClose?: () => void) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
    onClose?.();
    return;
  }
  Alert.alert(title, message, onClose ? [{ text: "OK", onPress: onClose }] : undefined);
}

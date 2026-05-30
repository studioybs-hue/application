import { Alert, Platform } from "react-native";
import { globalAlert, globalConfirm } from "@/src/ui/ConfirmDialog";

/**
 * Cross-platform confirm dialog.
 * On web: uses the branded modal (BrandedDialog), with fallback to window.confirm.
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
    // Use branded modal — falls back to window.confirm if provider not mounted
    globalConfirm({
      title,
      message,
      confirmText,
      cancelText,
      destructive: options?.destructive,
    }).then((ok) => {
      if (ok) onConfirm();
    }).catch(() => {
      // Fallback to native browser confirm if branded dialog is unavailable
      const ok = typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`);
      if (ok) onConfirm();
    });
    return;
  }
  Alert.alert(title, message, [
    { text: cancelText, style: "cancel" },
    { text: confirmText, style: options?.destructive ? "destructive" : "default", onPress: () => { onConfirm(); } },
  ]);
}

/**
 * Cross-platform alert (info message).
 * On web: branded modal. On native: Alert.alert.
 */
export function showAlert(title: string, message: string, onClose?: () => void) {
  if (Platform.OS === "web") {
    // Detect variant from title prefix
    let variant: "info" | "success" | "warning" | "danger" = "info";
    if (/^(✓|✅|🎉|🚀|👍)/.test(title) || title.toLowerCase().includes("succ") || title.toLowerCase().includes("bienvenue") || title.toLowerCase().includes("restauré")) {
      variant = "success";
    } else if (/^(❌|🚨|⛔)/.test(title) || title.toLowerCase().startsWith("erreur") || title.toLowerCase().startsWith("impossible") || title.toLowerCase().startsWith("échec")) {
      variant = "danger";
    } else if (/^(⚠️|⚡)/.test(title) || title.toLowerCase().includes("attention")) {
      variant = "warning";
    }
    globalAlert({ title, message, variant }).then(() => onClose?.()).catch(() => {
      if (typeof window !== "undefined") window.alert(`${title}\n\n${message}`);
      onClose?.();
    });
    return;
  }
  Alert.alert(title, message, onClose ? [{ text: "OK", onPress: onClose }] : undefined);
}

/**
 * Promise-based confirm dialog. Resolves true on confirm, false on cancel.
 * Cross-platform with branded modal on web.
 */
export function showConfirm(
  title: string,
  message: string,
  options?: { confirmText?: string; cancelText?: string; destructive?: boolean }
): Promise<boolean> {
  return new Promise((resolve) => {
    const confirmText = options?.confirmText || "Confirmer";
    const cancelText = options?.cancelText || "Annuler";
    if (Platform.OS === "web") {
      globalConfirm({
        title,
        message,
        confirmText,
        cancelText,
        destructive: options?.destructive,
      }).then(resolve).catch(() => {
        const ok = typeof window !== "undefined" && window.confirm(`${title}\n\n${message}`);
        resolve(!!ok);
      });
      return;
    }
    Alert.alert(title, message, [
      { text: cancelText, style: "cancel", onPress: () => resolve(false) },
      { text: confirmText, style: options?.destructive ? "destructive" : "default", onPress: () => resolve(true) },
    ], { cancelable: true, onDismiss: () => resolve(false) });
  });
}

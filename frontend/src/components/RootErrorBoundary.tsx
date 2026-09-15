import React from "react";
import { View, Text, Pressable, StyleSheet, ScrollView } from "react-native";
import { colors, spacing, radii } from "@/src/theme";

type Props = { children: React.ReactNode };
type State = { hasError: boolean; error?: Error };

/**
 * App-level ErrorBoundary + fallback screen.
 *
 * Safety net: if any JS init error is thrown while the root tree renders, the
 * user sees a branded recovery screen with a "Réessayer" button instead of a
 * white screen or a silent crash.
 *
 * NOTE (New Arch): this catches JS render/lifecycle errors only. A native
 * NSException raised at boot (the SIGABRT in ObjCTurboModule) is handled by the
 * patch-package fix on react-native (patches/react-native+0.81.5.patch), NOT here.
 */
export class RootErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("[RootErrorBoundary] JS render error:", error, info);
  }

  reset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <View style={styles.container} testID="root-error-boundary">
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.brand}>CINÉMARIÉS</Text>
          <Text style={styles.title} testID="root-error-title">
            Oups, un souci est survenu
          </Text>
          <Text style={styles.subtitle}>
            L&apos;application a rencontré une erreur au démarrage. Réessayez ; si le
            problème persiste, redémarrez l&apos;application.
          </Text>
          {__DEV__ && this.state.error ? (
            <Text style={styles.debug} testID="root-error-debug">
              {this.state.error.message}
            </Text>
          ) : null}
          <Pressable
            onPress={this.reset}
            style={styles.button}
            testID="root-error-retry-button"
          >
            <Text style={styles.buttonText}>Réessayer</Text>
          </Pressable>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    alignItems: "center",
    padding: spacing.xl,
    gap: spacing.md,
  },
  brand: {
    color: colors.gold,
    fontSize: 14,
    letterSpacing: 4,
    fontWeight: "700",
    marginBottom: spacing.sm,
  },
  title: {
    color: colors.textPrimary,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
  subtitle: {
    color: colors.textSecondary,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
  debug: {
    color: colors.textDisabled,
    fontSize: 12,
    textAlign: "center",
    marginTop: spacing.xs,
  },
  button: {
    marginTop: spacing.md,
    backgroundColor: colors.gold,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.lg,
    minWidth: 200,
    alignItems: "center",
  },
  buttonText: { color: colors.bg, fontSize: 16, fontWeight: "700" },
});

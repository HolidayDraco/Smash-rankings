import { Component, type ErrorInfo, type ReactNode } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { BodyText, DisplayText, colors, spacing, useFocusRing } from "@sr/ui";
import { reportRenderError } from "../lib/sentry";

/** Friendly full-page fallback shown when a screen crashes. */
export function CrashPanel({ onReload }: { onReload: () => void }) {
  const focusRing = useFocusRing();
  return (
    <View role="alert" style={styles.panel}>
      <DisplayText variant="h2" level={1}>
        Something went wrong
      </DisplayText>
      <BodyText muted>This page hit an unexpected error. Reloading usually fixes it.</BodyText>
      <Pressable
        role="button"
        aria-label="Reload the page"
        onPress={onReload}
        {...focusRing.handlers}
        style={[styles.button, focusRing.style]}
      >
        <BodyText variant="label" color={colors.white}>
          Reload
        </BodyText>
      </Pressable>
    </View>
  );
}

interface State {
  failed: boolean;
}

/** Catches render errors anywhere below it, reports them, and shows CrashPanel instead. */
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    reportRenderError(error, info.componentStack ?? undefined);
  }

  reload = () => {
    if (Platform.OS === "web") window.location.reload();
    else this.setState({ failed: false });
  };

  override render() {
    return this.state.failed ? <CrashPanel onReload={this.reload} /> : this.props.children;
  }
}

const styles = StyleSheet.create({
  panel: {
    width: "100%",
    maxWidth: 560,
    alignSelf: "center",
    gap: spacing.md,
    padding: spacing.xl,
  },
  button: {
    alignSelf: "flex-start",
    minHeight: 44,
    justifyContent: "center",
    paddingHorizontal: spacing.lg,
    backgroundColor: colors.accent,
  },
});

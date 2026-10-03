import type { ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import { colors, cutAngleDeg, spacing } from "../tokens";

export type PanelTone = "surface" | "accent" | "ink" | "signal";

const toneColor: Record<PanelTone, string> = {
  surface: colors.surface,
  accent: colors.accent,
  ink: colors.ink,
  signal: colors.signal,
};

export interface AngledPanelProps {
  tone?: PanelTone;
  /** Show the hot-red edge stripe on the leading side. */
  stripe?: boolean;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}

/**
 * A parallelogram panel. The background is a skewed layer behind unskewed content, so text stays
 * upright and crisp. Uses only transforms, so it works the same on web, iOS, and Android.
 * Put text on it only with approved pairs (see `textPairs`).
 */
export function AngledPanel({
  tone = "surface",
  stripe = true,
  style,
  children,
}: AngledPanelProps) {
  const skew = `-${cutAngleDeg}deg`;
  return (
    <View style={[styles.root, style]}>
      <View
        pointerEvents="none"
        aria-hidden
        style={[styles.layer, { backgroundColor: toneColor[tone], transform: [{ skewX: skew }] }]}
      />
      {stripe ? (
        <View
          pointerEvents="none"
          aria-hidden
          style={[styles.stripe, { transform: [{ skewX: skew }] }]}
        />
      ) : null}
      <View style={styles.content}>{children}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: "relative", marginHorizontal: spacing.lg },
  layer: { ...StyleSheet.absoluteFill },
  stripe: {
    position: "absolute",
    top: 0,
    bottom: 0,
    left: -spacing.md,
    width: spacing.sm,
    backgroundColor: colors.hot,
  },
  // Extra horizontal padding keeps content inside the slanted edges.
  content: { paddingVertical: spacing.xl, paddingHorizontal: spacing.xl + spacing.sm },
});

import { StyleSheet, View } from "react-native";
import { Attribution, BodyText, colors, minTouchTarget, spacing } from "@sr/ui";
import { isDemoMode } from "../lib/demoMode";

export const SAMPLE_DATA_NOTICE = "Sample data, not from start.gg";

/**
 * Footer credit. Live data carries the start.gg attribution. Demo mode shows made-up Sample_
 * players, so crediting start.gg there would be false; it says sample data instead.
 */
export function DataCredit({ demo = isDemoMode() }: { demo?: boolean }) {
  if (!demo) return <Attribution />;
  return (
    <View style={styles.footer}>
      <BodyText variant="bodySm" color={colors.ink}>
        {SAMPLE_DATA_NOTICE}
      </BodyText>
    </View>
  );
}

// Same frame as Attribution so the footer doesn't shift between modes.
const styles = StyleSheet.create({
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    minHeight: minTouchTarget + spacing.lg * 2,
    justifyContent: "center",
  },
});

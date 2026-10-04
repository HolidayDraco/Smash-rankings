import { StyleSheet, View } from "react-native";
import { BodyText, colors, spacing } from "@sr/ui";

export const DEMO_TAG_LABEL = "Demo data: sample rankings, not real results";

/** Small skewed label shown in the header while demo mode is on. Ink on signal yellow (fill-only color). */
export function DemoTag() {
  return (
    <View role="note" aria-label={DEMO_TAG_LABEL} style={styles.tag}>
      <BodyText variant="label" color={colors.ink} style={styles.text}>
        Demo data
      </BodyText>
    </View>
  );
}

const styles = StyleSheet.create({
  tag: {
    backgroundColor: colors.signal,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderWidth: 2,
    borderColor: colors.ink,
    transform: [{ skewX: "-12deg" }],
  },
  // Undo the skew so the letters stay upright and easy to read.
  text: {
    transform: [{ skewX: "12deg" }],
    textTransform: "uppercase",
    fontSize: 12,
    lineHeight: 16,
  },
});

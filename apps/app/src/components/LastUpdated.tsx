import { StyleSheet, View } from "react-native";
import { BodyText, colors, spacing } from "@sr/ui";
import { useMeta } from "../lib/api";
import { relativeTime } from "../lib/format";

/** "Last updated 12 min ago" from /v1/meta; the exact time is in the accessible label. */
export function LastUpdated() {
  const { data } = useMeta();
  if (!data?.lastRatedAt) return null;
  const exact = new Date(data.lastRatedAt).toLocaleString();
  return (
    <View
      role="status"
      aria-label={`Last updated ${relativeTime(data.lastRatedAt)}, at ${exact}`}
      style={styles.badge}
    >
      <View aria-hidden style={styles.dot} />
      <BodyText variant="label" color={colors.ink}>
        Last updated {relativeTime(data.lastRatedAt)}
      </BodyText>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    alignSelf: "flex-start",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    backgroundColor: colors.signal,
    transform: [{ skewX: "-12deg" }],
  },
  dot: { width: 8, height: 8, backgroundColor: colors.ink },
});

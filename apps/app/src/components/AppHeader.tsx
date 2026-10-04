import { StyleSheet, View } from "react-native";
import { DisplayText, colors, minTouchTarget, spacing } from "@sr/ui";
import { isDemoMode } from "../lib/demoMode";
import { DemoTag } from "./DemoTag";
import { PrimaryNav, useNavVariant } from "./PrimaryNav";

export function AppHeader() {
  // On phones the tabs move to the bottom bar (rendered by the root layout), so the header drops them.
  const showTabs = useNavVariant() === "top";
  return (
    <View role="banner" style={styles.bar}>
      <View style={styles.brand}>
        <View aria-hidden style={styles.mark} />
        <DisplayText variant="h3" level={null} color={colors.ink}>
          Bracket Index
        </DisplayText>
        {isDemoMode() ? <DemoTag /> : null}
      </View>
      {showTabs ? <PrimaryNav variant="top" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    borderBottomWidth: 3,
    borderBottomColor: colors.ink,
    backgroundColor: colors.white,
  },
  brand: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: minTouchTarget },
  mark: {
    width: 14,
    height: 26,
    backgroundColor: colors.accent,
    transform: [{ skewX: "-12deg" }],
  },
});

import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Attribution, colors, spacing } from "@sr/ui";
import { ActionLink } from "./ActionLink";

/** Standard screen frame: scrolling content, centered column, and the attribution footer. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View role="main" style={styles.main}>
        {children}
      </View>
      <View style={styles.footer}>
        <View role="navigation" aria-label="Footer" style={styles.links}>
          <ActionLink label="How rankings work" href="/methodology" />
          <ActionLink label="Status" href="/status" />
        </View>
        <Attribution />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: colors.white },
  container: { flexGrow: 1 },
  main: {
    width: "100%",
    maxWidth: 1100,
    alignSelf: "center",
    paddingVertical: spacing.xl,
    flexGrow: 1,
  },
  links: {
    flexDirection: "row",
    flexWrap: "wrap",
    columnGap: spacing.xl,
    paddingHorizontal: spacing.lg,
  },
  footer: { width: "100%", maxWidth: 1100, alignSelf: "center" },
});

import type { ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Attribution, colors, spacing } from "@sr/ui";

/** Standard screen frame: scrolling content, centered column, and the attribution footer. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container}>
      <View role="main" style={styles.main}>
        {children}
      </View>
      <View style={styles.footer}>
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
  footer: { width: "100%", maxWidth: 1100, alignSelf: "center" },
});

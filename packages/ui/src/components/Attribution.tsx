import { Linking, Platform, Pressable, StyleSheet, View, type PressableProps } from "react-native";
import { ATTRIBUTION } from "@sr/core";
import { useFocusRing } from "../hooks/useFocusRing";
import { colors, minTouchTarget, spacing } from "../tokens";
import { BodyText } from "./BodyText";

export const STARTGG_URL = "https://www.start.gg/";

/** Required on every screen that shows start.gg data. */
export function Attribution() {
  const ring = useFocusRing();
  // RN Web turns `href` into a real anchor. Native has no href, so it opens the URL via Linking.
  const webProps =
    Platform.OS === "web"
      ? ({
          href: STARTGG_URL,
          hrefAttrs: { target: "_blank", rel: "noopener noreferrer" },
        } as object)
      : {};
  const onPress: PressableProps["onPress"] =
    Platform.OS === "web"
      ? undefined
      : () => {
          void Linking.openURL(STARTGG_URL);
        };
  return (
    <View style={styles.footer}>
      <Pressable
        role="link"
        aria-label={`${ATTRIBUTION} (opens start.gg)`}
        onPress={onPress}
        {...ring.handlers}
        {...webProps}
        style={[styles.link, ring.style]}
      >
        <BodyText variant="bodySm" color={colors.ink} style={styles.text}>
          {ATTRIBUTION}
        </BodyText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
    alignItems: "flex-start",
  },
  link: { minHeight: minTouchTarget, justifyContent: "center" },
  text: { textDecorationLine: "underline" },
});

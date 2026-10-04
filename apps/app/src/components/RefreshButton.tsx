import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { BodyText, colors, minTouchTarget, useFocusRing } from "@sr/ui";
import { REFRESH_LABEL, REFRESH_LABEL_NEW_VERSION } from "../lib/buildVersion";
import { useNewVersion } from "../lib/useNewVersion";

/**
 * Header button. Web: reloads the page (picks up a new deploy, which matters on a home-screen app
 * with no browser reload button). Native: refetches every query. A dot shows when a new build is live.
 */
export function RefreshButton() {
  const queryClient = useQueryClient();
  const ring = useFocusRing();
  const newVersion = useNewVersion();
  const busy = useRef(false);
  const label = newVersion ? REFRESH_LABEL_NEW_VERSION : REFRESH_LABEL;

  const onPress = () => {
    if (busy.current) return; // double taps must not loop
    busy.current = true;
    if (Platform.OS === "web") {
      // A full reload fetches fresh data and the newest build, so no separate refetch is needed.
      window.location.reload();
      return;
    }
    void queryClient.refetchQueries().finally(() => {
      busy.current = false;
    });
  };

  return (
    <Pressable
      role="button"
      aria-label={label}
      onPress={onPress}
      {...ring.handlers}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, ring.style]}
    >
      <BodyText variant="label" color={colors.ink} aria-hidden style={styles.glyph}>
        {"↻"}
      </BodyText>
      {newVersion ? <View testID="refresh-dot" aria-hidden style={styles.dot} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: minTouchTarget,
    height: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.6 },
  glyph: { fontSize: 26, lineHeight: 30 },
  dot: {
    position: "absolute",
    top: 8,
    right: 8,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.white,
  },
});

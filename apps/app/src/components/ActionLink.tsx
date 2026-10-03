import { Link } from "expo-router";
import { Linking, Platform, Pressable, StyleSheet, type PressableProps } from "react-native";
import { BodyText, colors, minTouchTarget, spacing, useFocusRing } from "@sr/ui";

/** Text button/link with a 44 px target and visible focus. `external` opens in a new tab or the browser. */
export function ActionLink({
  label,
  text,
  href,
  external,
  onPress,
  solid,
}: {
  label: string;
  /** Visible text when it differs from the accessible label (e.g. an arrow that screen readers skip). */
  text?: string;
  href?: string;
  external?: boolean;
  onPress?: PressableProps["onPress"];
  solid?: boolean;
}) {
  const ring = useFocusRing();
  const webProps =
    Platform.OS === "web" && href
      ? ({
          href,
          hrefAttrs: external ? { target: "_blank", rel: "noopener noreferrer" } : undefined,
        } as object)
      : {};
  const press =
    external && Platform.OS !== "web" && href ? () => void Linking.openURL(href) : onPress;
  const node = (
    <Pressable
      role={onPress && !href ? "button" : "link"}
      aria-label={external && Platform.OS === "web" ? `${label} (opens in a new tab)` : label}
      onPress={press}
      {...ring.handlers}
      {...webProps}
      style={StyleSheet.flatten([styles.action, solid && styles.solid, ring.style])}
    >
      <BodyText variant="label" color={solid ? colors.white : colors.accent}>
        {text ?? label}
      </BodyText>
    </Pressable>
  );
  return href && !external ? (
    <Link href={href as "/"} asChild>
      {node}
    </Link>
  ) : (
    node
  );
}

const styles = StyleSheet.create({
  action: { minHeight: minTouchTarget, justifyContent: "center", alignSelf: "flex-start" },
  solid: { backgroundColor: colors.ink, paddingHorizontal: spacing.xl },
});

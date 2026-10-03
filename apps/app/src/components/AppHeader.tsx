import { Link, usePathname } from "expo-router";
import { StyleSheet, View } from "react-native";
import { BodyText, DisplayText, colors, minTouchTarget, spacing, useFocusRing } from "@sr/ui";

function NavLink({ href, label }: { href: "/" | "/style-guide"; label: string }) {
  const ring = useFocusRing();
  const active = usePathname() === href;
  return (
    <Link
      href={href}
      role="link"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      {...ring.handlers}
      style={[styles.link, ring.style, active && styles.linkActive]}
    >
      <BodyText variant="label" color={colors.ink}>
        {label}
      </BodyText>
    </Link>
  );
}

export function AppHeader() {
  return (
    <View role="banner" style={styles.bar}>
      <View style={styles.brand}>
        <View aria-hidden style={styles.mark} />
        <DisplayText variant="h3" level={null} color={colors.ink}>
          Smash Rankings
        </DisplayText>
      </View>
      <View role="navigation" aria-label="Primary" style={styles.nav}>
        <NavLink href="/" label="Home" />
        <NavLink href="/style-guide" label="Style guide" />
      </View>
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
  nav: { flexDirection: "row", gap: spacing.xs },
  link: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
  },
  linkActive: { borderBottomColor: colors.accent },
});

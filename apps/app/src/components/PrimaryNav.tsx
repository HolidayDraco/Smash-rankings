import { Link, usePathname } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LAUNCH_REGIONS, STATE_NAMES } from "@sr/core";
import { activeTab, type TabHref } from "../lib/nav";
import { BodyText, colors, minTouchTarget, spacing, useFocusRing } from "@sr/ui";

/** At or above this width the tabs sit in the header; below it they become a bottom bar. */
export const DESKTOP_BREAKPOINT = 768;

type TabShape = "slash" | "diamond";

const TABS: readonly { href: TabHref; label: string; shape: TabShape }[] = [
  { href: "/", label: "Dashboard", shape: "slash" },
  // The region tab's label comes from the launch region (config, not hard-coded; ADR-0003).
  {
    href: "/texas",
    label: STATE_NAMES[LAUNCH_REGIONS.states[0]] ?? LAUNCH_REGIONS.states[0],
    shape: "diamond",
  },
];

/** Small original geometric marks (no icon font). Decorative: hidden from screen readers. */
function Mark({ shape, color }: { shape: TabShape; color: string }) {
  return (
    <View
      aria-hidden
      style={[shape === "slash" ? styles.slash : styles.diamond, { backgroundColor: color }]}
    />
  );
}

function Tab({
  href,
  label,
  shape,
  active,
  variant,
}: {
  href: TabHref;
  label: string;
  shape: TabShape;
  active: boolean;
  variant: "top" | "bottom";
}) {
  const ring = useFocusRing();
  const markColor = active ? colors.accent : colors.inkMuted;
  const bottom = variant === "bottom";
  return (
    <Link href={href} asChild>
      <Pressable
        role="link"
        aria-label={label}
        aria-current={active ? "page" : undefined}
        {...ring.handlers}
        // Flattened: Link asChild merges styles as objects, so an array would be mangled.
        style={StyleSheet.flatten([
          bottom ? styles.bottomTab : styles.topTab,
          active && (bottom ? styles.bottomActive : styles.topActive),
          ring.style,
        ])}
      >
        <Mark shape={shape} color={markColor} />
        <BodyText variant="label" color={active ? colors.accent : colors.ink}>
          {label}
        </BodyText>
      </Pressable>
    </Link>
  );
}

/**
 * Which layout to use. The site is a static export, so the server cannot know the screen width.
 * Until the browser has mounted we always answer "top" (the same markup the server wrote), then
 * switch to "bottom" on narrow screens. Only one nav exists at a time.
 */
export function useNavVariant(): "top" | "bottom" {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const { width } = useWindowDimensions();
  return mounted && width < DESKTOP_BREAKPOINT ? "bottom" : "top";
}

export function PrimaryNav({ variant }: { variant: "top" | "bottom" }) {
  const current = activeTab(usePathname());
  return (
    <View
      role="navigation"
      aria-label="Primary"
      style={variant === "bottom" ? styles.bottomNav : styles.topNav}
    >
      {TABS.map((tab) => (
        <Tab key={tab.href} {...tab} active={current === tab.href} variant={variant} />
      ))}
    </View>
  );
}

/** Bottom bar for phones. It is a normal flex child below the screen, so it never covers content. */
export function BottomTabBar() {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bottomWrap, { paddingBottom: insets.bottom }]}>
      <PrimaryNav variant="bottom" />
    </View>
  );
}

const styles = StyleSheet.create({
  topNav: { flexDirection: "row", gap: spacing.xs },
  topTab: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: 3,
    borderBottomColor: "transparent",
  },
  topActive: { borderBottomColor: colors.accent },
  bottomWrap: {
    backgroundColor: colors.white,
    borderTopWidth: 3,
    borderTopColor: colors.ink,
  },
  bottomNav: { flexDirection: "row" },
  bottomTab: {
    flex: 1,
    minHeight: 56,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    borderTopWidth: 3,
    borderTopColor: "transparent",
    marginTop: -3,
  },
  bottomActive: { borderTopColor: colors.accent },
  slash: { width: 8, height: 14, transform: [{ skewX: "-14deg" }] },
  diamond: { width: 10, height: 10, transform: [{ rotate: "45deg" }] },
});

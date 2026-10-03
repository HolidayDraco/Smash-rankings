import { useEffect, useState } from "react";
import { AccessibilityInfo, Platform } from "react-native";

interface MediaQueryListLike {
  matches: boolean;
}

/** Synchronous read on web (no DOM lib in this package, so the global is typed by hand). */
function readWebPreference(): boolean | null {
  if (Platform.OS !== "web") return null;
  const matchMedia = (globalThis as { matchMedia?: (query: string) => MediaQueryListLike })
    .matchMedia;
  return matchMedia ? matchMedia("(prefers-reduced-motion: reduce)").matches : null;
}

/**
 * Whether the user asked for reduced motion. `null` means "not known yet": callers should not
 * start animations until it is a boolean.
 */
export function useReducedMotion(): boolean | null {
  const [reduced, setReduced] = useState<boolean | null>(readWebPreference);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (active) setReduced(value);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduced);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

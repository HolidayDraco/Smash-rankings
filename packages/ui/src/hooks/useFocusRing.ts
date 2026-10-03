import { useState } from "react";
import type { ViewStyle } from "react-native";
import { colors } from "../tokens";

/** Visible keyboard focus outline. Spread `handlers` on a Pressable and `style` into its style. */
export function useFocusRing() {
  const [focused, setFocused] = useState(false);
  const style: ViewStyle = focused
    ? { outlineWidth: 3, outlineStyle: "solid", outlineColor: colors.accent, outlineOffset: 2 }
    : {};
  return {
    style,
    handlers: { onFocus: () => setFocused(true), onBlur: () => setFocused(false) },
  };
}

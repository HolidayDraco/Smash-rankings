import type { ReactNode } from "react";
import { Text, type TextProps, type TextStyle } from "react-native";
import { colors, typeScale } from "../tokens";

export type DisplayVariant = "display" | "h1" | "h2" | "h3";

const defaultLevel: Record<DisplayVariant, 1 | 2 | 3> = { display: 1, h1: 1, h2: 2, h3: 3 };

export interface DisplayTextProps extends Omit<TextProps, "role"> {
  variant?: DisplayVariant;
  /** Heading level for assistive tech. Pass `null` for decorative (non-heading) text. */
  level?: 1 | 2 | 3 | 4 | null;
  color?: string;
  children: ReactNode;
}

/** Bold condensed italic display type (Barlow Condensed Black/ExtraBold Italic). */
export function DisplayText({
  variant = "h1",
  level,
  color = colors.ink,
  style,
  children,
  ...rest
}: DisplayTextProps) {
  const token: TextStyle = typeScale[variant];
  const resolved = level === undefined ? defaultLevel[variant] : level;
  const headingProps =
    resolved === null ? {} : ({ role: "heading", "aria-level": resolved } as const);
  return (
    <Text {...headingProps} {...rest} style={[token, { color }, style]}>
      {children}
    </Text>
  );
}

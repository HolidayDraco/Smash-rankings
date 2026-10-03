import { Text, type TextProps, type TextStyle } from "react-native";
import { colors, typeScale, type TypeVariant } from "../tokens";

export interface BodyTextProps extends TextProps {
  variant?: Extract<TypeVariant, "body" | "bodySm" | "label" | "stat">;
  muted?: boolean;
  color?: string;
}

/** UI and body text (Barlow). Scales with the user's font-size setting. */
export function BodyText({ variant = "body", muted, color, style, ...rest }: BodyTextProps) {
  const token: TextStyle = typeScale[variant];
  const resolvedColor = color ?? (muted ? colors.inkMuted : colors.ink);
  return (
    <Text
      {...rest}
      style={[
        token,
        variant === "stat" && { fontVariant: ["tabular-nums"] },
        { color: resolvedColor },
        style,
      ]}
    />
  );
}

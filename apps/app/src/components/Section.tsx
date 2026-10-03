import type { ReactNode } from "react";
import { View } from "react-native";
import { BodyText, DisplayText, spacing } from "@sr/ui";

export function Section({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: ReactNode;
}) {
  return (
    <View
      role="region"
      aria-label={title}
      style={{ marginBottom: spacing.huge, paddingHorizontal: spacing.lg }}
    >
      <DisplayText variant="h2" style={{ marginBottom: spacing.xs }}>
        {title}
      </DisplayText>
      {note ? (
        <BodyText muted style={{ marginBottom: spacing.lg }}>
          {note}
        </BodyText>
      ) : null}
      {children}
    </View>
  );
}

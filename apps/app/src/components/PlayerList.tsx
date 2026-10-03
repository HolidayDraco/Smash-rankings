import { useEffect, useRef, type ReactNode } from "react";
import { Animated, Platform, Pressable, StyleSheet, View } from "react-native";
import {
  BodyText,
  colors,
  durations,
  minTouchTarget,
  spacing,
  useFocusRing,
  useReducedMotion,
} from "@sr/ui";
import { PlayerRow, PlayerRowHeader, SkeletonRow, type PlayerRowProps } from "./PlayerRow";

export interface PlayerListProps {
  label: string;
  status: "pending" | "error" | "success";
  rows: readonly PlayerRowProps[];
  emptyText: string;
  onRetry: () => void;
  /** Show the Rk / Player / Score column heads (leaderboard only). */
  showHeader?: boolean;
}

/** Shared by the leaderboard and search results: skeleton, error with retry, empty, or rows. */
export function PlayerList({
  label,
  status,
  rows,
  emptyText,
  onRetry,
  showHeader,
}: PlayerListProps) {
  const ring = useFocusRing();
  const reduced = useReducedMotion();
  const opacity = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (status !== "success" || reduced === null) return;
    if (reduced) {
      opacity.setValue(1);
      return;
    }
    opacity.setValue(0);
    Animated.timing(opacity, {
      toValue: 1,
      duration: durations.base,
      useNativeDriver: Platform.OS !== "web",
    }).start();
  }, [status, reduced, opacity]);

  if (status === "pending") {
    return (
      <View aria-busy aria-label={`Loading ${label}`} role="status">
        {Array.from({ length: 12 }, (_, index) => (
          <SkeletonRow key={index} />
        ))}
      </View>
    );
  }
  if (status === "error") {
    return (
      <View role="alert" style={styles.message}>
        <BodyText variant="bodySm">
          We could not load {label}. Check your connection and try again.
        </BodyText>
        <Pressable
          role="button"
          aria-label={`Try again: load ${label}`}
          onPress={onRetry}
          {...ring.handlers}
          style={[styles.retry, ring.style]}
        >
          <BodyText variant="label" color={colors.white}>
            Try again
          </BodyText>
        </Pressable>
      </View>
    );
  }
  if (rows.length === 0) {
    return (
      <View style={styles.message}>
        <BodyText>{emptyText}</BodyText>
      </View>
    );
  }
  const content: ReactNode = (
    <View role="list" aria-label={label}>
      {rows.map((row) => (
        <PlayerRow key={row.playerId} {...row} />
      ))}
    </View>
  );
  return (
    <Animated.View style={{ opacity }}>
      {showHeader ? <PlayerRowHeader /> : null}
      {content}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  message: { padding: spacing.lg, gap: spacing.md, alignItems: "flex-start" },
  retry: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.ink,
  },
});

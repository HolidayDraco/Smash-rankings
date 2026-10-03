import { Link } from "expo-router";
import { Pressable, StyleSheet, View } from "react-native";
import {
  BodyText,
  DisplayText,
  colors,
  fontFamilies,
  minTouchTarget,
  spacing,
  typeScale,
  useFocusRing,
} from "@sr/ui";
import { playerHref } from "../lib/format";

export interface PlayerRowProps {
  playerId: string;
  /** Null for a player who is not on the leaderboard yet (search results). */
  rank: number | null;
  tag: string;
  prefix: string | null;
  country?: string | null;
  score?: number;
  /** Rank places gained (positive) or lost (negative) in 7 days. Null means no data yet. */
  delta?: number | null;
}

export const COLS = { rank: 44, score: 56, delta: 64 } as const;

const describeDelta = (delta: number | null | undefined) =>
  delta == null
    ? "no 7-day change yet"
    : delta === 0
      ? "unchanged"
      : `${delta > 0 ? "up" : "down"} ${Math.abs(delta)} places`;

/** One tappable leaderboard or search row. The change uses an arrow and a signed number, not color alone. */
export function PlayerRow({ playerId, rank, tag, prefix, country, score, delta }: PlayerRowProps) {
  const ring = useFocusRing();
  const up = delta != null && delta > 0;
  const down = delta != null && delta < 0;
  const deltaColor = up ? colors.positive : down ? colors.negative : colors.inkMuted;
  const label = [
    rank === null ? "Not yet ranked" : `Rank ${rank}`,
    prefix ? `${prefix} ${tag}` : tag,
    country,
    score === undefined ? null : `score ${score}`,
    score === undefined ? null : describeDelta(delta),
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <View role="listitem">
      <Link href={playerHref(playerId, tag)} asChild>
        <Pressable
          role="link"
          aria-label={label}
          {...ring.handlers}
          // Flattened: Link asChild merges styles as objects, so an array would be mangled.
          style={StyleSheet.flatten([styles.row, ring.style])}
        >
          <View style={{ width: COLS.rank }}>
            {rank === null ? (
              <BodyText variant="label" muted>
                NR
              </BodyText>
            ) : (
              <DisplayText variant="h3" level={null} color={rank <= 3 ? colors.accent : colors.ink}>
                {rank}
              </DisplayText>
            )}
          </View>
          <View style={styles.tagCol}>
            <BodyText variant="stat" numberOfLines={1} style={styles.tag}>
              {prefix ? (
                <BodyText variant="bodySm" muted>
                  {prefix}{" "}
                </BodyText>
              ) : null}
              {tag}
            </BodyText>
            {country ? (
              <BodyText variant="label" muted>
                {country}
              </BodyText>
            ) : null}
          </View>
          {score === undefined ? null : (
            <>
              <View style={[styles.right, { width: COLS.score }]}>
                <BodyText variant="stat">{score}</BodyText>
              </View>
              <View style={[styles.deltaCol, { width: COLS.delta }]}>
                {up || down ? (
                  <View
                    aria-hidden
                    style={[
                      styles.arrow,
                      up
                        ? { borderBottomWidth: 8, borderBottomColor: deltaColor }
                        : { borderTopWidth: 8, borderTopColor: deltaColor },
                    ]}
                  />
                ) : null}
                <BodyText variant="stat" color={deltaColor}>
                  {delta == null ? "–" : delta === 0 ? "0" : `${up ? "+" : "−"}${Math.abs(delta)}`}
                </BodyText>
              </View>
            </>
          )}
        </Pressable>
      </Link>
    </View>
  );
}

/** Column headings that line up with the rows. Hidden from assistive tech (rows carry full labels). */
export function PlayerRowHeader() {
  return (
    <View aria-hidden style={[styles.row, styles.header]}>
      <View style={{ width: COLS.rank }}>
        <BodyText variant="label" muted>
          Rk
        </BodyText>
      </View>
      <View style={styles.tagCol}>
        <BodyText variant="label" muted>
          Player
        </BodyText>
      </View>
      <View style={[styles.right, { width: COLS.score }]}>
        <BodyText variant="label" muted>
          Score
        </BodyText>
      </View>
      <View style={[styles.right, { width: COLS.delta }]}>
        <BodyText variant="label" muted>
          7 days
        </BodyText>
      </View>
    </View>
  );
}

/** Grey placeholder row with the same height as a real row. */
export function SkeletonRow() {
  return (
    <View aria-hidden testID="skeleton-row" style={styles.row}>
      <View style={{ width: COLS.rank }}>
        <View style={[styles.bar, { width: 24 }]} />
      </View>
      <View style={[styles.tagCol, { gap: spacing.xs }]}>
        <View style={[styles.bar, { width: "55%" }]} />
        <View style={[styles.bar, { width: 28, height: 8 }]} />
      </View>
      <View style={[styles.bar, { width: 36 }]} />
      <View style={[styles.bar, { width: 40, marginLeft: spacing.lg }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: minTouchTarget + 8,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  header: { minHeight: 32, borderBottomWidth: 2, borderBottomColor: colors.ink },
  tagCol: { flex: 1, paddingRight: spacing.sm },
  tag: { fontFamily: fontFamilies.bodyBold, fontSize: typeScale.body.fontSize },
  right: { alignItems: "flex-end" },
  deltaCol: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    gap: spacing.xs,
  },
  arrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
  },
  bar: { height: 14, backgroundColor: colors.line },
});

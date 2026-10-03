import { StyleSheet, View } from "react-native";
import { colors, fontFamilies, minTouchTarget, spacing, typeScale } from "../tokens";
import { BodyText } from "./BodyText";
import { DisplayText } from "./DisplayText";

export interface StatRowProps {
  rank: number;
  tag: string;
  /** Two-letter country code, shown as text. */
  country?: string;
  rating: number;
  /** Rating deviation: the +/- uncertainty on the rating. */
  rd: number;
  /** Rating change since the last period. Positive is up. */
  delta: number;
}

const COLS = { rank: 40, rating: 56, rd: 48, delta: 64 } as const;

function describeDelta(delta: number): string {
  if (delta > 0) return `up ${delta}`;
  if (delta < 0) return `down ${Math.abs(delta)}`;
  return "unchanged";
}

/** Column header that lines up with StatRow. Hidden from assistive tech (rows carry full labels). */
export function StatRowHeader() {
  return (
    <View aria-hidden style={styles.row} importantForAccessibility="no-hide-descendants">
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
      <View style={[styles.right, { width: COLS.rating }]}>
        <BodyText variant="label" muted>
          Rating
        </BodyText>
      </View>
      <View style={[styles.right, { width: COLS.rd }]}>
        <BodyText variant="label" muted>
          ±RD
        </BodyText>
      </View>
      <View style={[styles.right, { width: COLS.delta }]}>
        <BodyText variant="label" muted>
          Change
        </BodyText>
      </View>
    </View>
  );
}

/** One dense leaderboard row. The change column uses an arrow shape and a signed number, not color alone. */
export function StatRow({ rank, tag, country, rating, rd, delta }: StatRowProps) {
  const up = delta > 0;
  const down = delta < 0;
  const deltaColor = up ? colors.positive : down ? colors.negative : colors.inkMuted;
  const sign = up ? "+" : down ? "−" : "";
  const label = `Rank ${rank}, ${tag}${country ? `, ${country}` : ""}, rating ${rating} plus or minus ${rd}, ${describeDelta(delta)}`;
  return (
    <View role="listitem" aria-label={label} style={[styles.row, styles.dataRow]}>
      <View style={{ width: COLS.rank }}>
        <DisplayText variant="h3" level={null} color={rank <= 3 ? colors.accent : colors.ink}>
          {rank}
        </DisplayText>
      </View>
      <View style={styles.tagCol}>
        <BodyText
          variant="stat"
          numberOfLines={1}
          style={{ fontFamily: fontFamilies.bodyBold, fontSize: typeScale.body.fontSize }}
        >
          {tag}
        </BodyText>
        {country ? (
          <BodyText variant="label" muted>
            {country}
          </BodyText>
        ) : null}
      </View>
      <View style={[styles.right, { width: COLS.rating }]}>
        <BodyText variant="stat">{rating}</BodyText>
      </View>
      <View style={[styles.right, { width: COLS.rd }]}>
        <BodyText variant="stat" muted>
          ±{rd}
        </BodyText>
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
        ) : (
          <View aria-hidden style={[styles.flat, { backgroundColor: deltaColor }]} />
        )}
        <BodyText variant="stat" color={deltaColor}>
          {sign}
          {Math.abs(delta)}
        </BodyText>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingHorizontal: spacing.sm },
  dataRow: {
    minHeight: minTouchTarget,
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  tagCol: { flex: 1, paddingRight: spacing.sm },
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
  flat: { width: 10, height: 2 },
});

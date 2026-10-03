import Head from "expo-router/head";
import { StyleSheet, View } from "react-native";
import {
  AngledPanel,
  BodyText,
  DisplayText,
  MotionSample,
  StatRow,
  StatRowHeader,
  colors,
  contrastRatio,
  spacing,
  textPairs,
  typeScale,
  type ColorToken,
} from "@sr/ui";
import { Page } from "../components/Page";
import { Section } from "../components/Section";

const TITLE = "Style guide | Bracket Index";
const DESCRIPTION = "Type, color, angled panels, dense stats, and motion for Bracket Index.";

// Obviously fake sample players.
const SAMPLE_ROWS = [
  { rank: 1, tag: "Zorblax", country: "US", rating: 2140, rd: 62, delta: 18 },
  { rank: 2, tag: "NotARealTag", country: "JP", rating: 2096, rd: 71, delta: -7 },
  { rank: 3, tag: "Sample_Pal", country: "CA", rating: 2051, rd: 58, delta: 0 },
  { rank: 4, tag: "Fakey McFake", country: "GB", rating: 1988, rd: 90, delta: 24 },
] as const;

const SWATCHES: readonly ColorToken[] = [
  "white",
  "surface",
  "line",
  "ink",
  "inkMuted",
  "accent",
  "hot",
  "signal",
  "positive",
  "negative",
];

function bestUse(token: ColorToken): string {
  const pair = textPairs.find((p) => p.foreground === token && p.background === "white");
  if (pair) return `${contrastRatio(colors[token], colors.white).toFixed(1)}:1 on white`;
  const asBg = textPairs.find((p) => p.background === token);
  if (asBg) {
    const fg = asBg.foreground;
    return `${contrastRatio(colors[fg], colors[token]).toFixed(1)}:1 with ${fg} text`;
  }
  return "Fill or border only, no text";
}

export default function StyleGuide() {
  return (
    <Page>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
      </Head>
      <View style={{ paddingHorizontal: spacing.lg, marginBottom: spacing.xl }}>
        <DisplayText variant="display">Style guide</DisplayText>
        <BodyText muted>
          Light theme only. Barlow Condensed for display, Barlow for UI. Original work, no Nintendo
          assets.
        </BodyText>
      </View>

      <Section title="Display type" note="Barlow Condensed Black and ExtraBold Italic, uppercase.">
        {(["display", "h1", "h2", "h3"] as const).map((variant) => (
          <View key={variant} style={styles.typeRow}>
            <BodyText variant="label" muted>
              {variant} {typeScale[variant].fontSize}/{typeScale[variant].lineHeight}
            </BodyText>
            <DisplayText variant={variant} level={null}>
              Rank one
            </DisplayText>
          </View>
        ))}
        {(["body", "bodySm", "label", "stat"] as const).map((variant) => (
          <View key={variant} style={styles.typeRow}>
            <BodyText variant="label" muted>
              {variant} {typeScale[variant].fontSize}/{typeScale[variant].lineHeight}
            </BodyText>
            <BodyText variant={variant}>Barlow for interface text 2140 ±62</BodyText>
          </View>
        ))}
      </Section>

      <Section title="Color" note="Text pairs are tested to be at least 4.5:1 contrast.">
        <View style={styles.swatches}>
          {SWATCHES.map((token) => (
            <View key={token} style={styles.swatch}>
              <View style={[styles.chip, { backgroundColor: colors[token] }]} />
              <BodyText variant="stat">{token}</BodyText>
              <BodyText variant="bodySm" muted>
                {colors[token]}
              </BodyText>
              <BodyText variant="bodySm" muted>
                {bestUse(token)}
              </BodyText>
            </View>
          ))}
        </View>
      </Section>

      <Section
        title="Angled panel"
        note="One 12 degree cut used everywhere. Content stays upright."
      >
        <AngledPanel tone="accent">
          <DisplayText variant="h2" level={null} color={colors.white}>
            Weekly movers
          </DisplayText>
          <BodyText color={colors.white}>
            Panels carry highlights. Text on them uses approved pairs only.
          </BodyText>
        </AngledPanel>
      </Section>

      <Section
        title="Dense stat row"
        note="Rank, player, rating, uncertainty, and change. Sample data only."
      >
        <View role="list" aria-label="Sample leaderboard">
          <StatRowHeader />
          {SAMPLE_ROWS.map((row) => (
            <StatRow key={row.tag} {...row} />
          ))}
        </View>
      </Section>

      <Section
        title="Motion"
        note="Snappy: 280 ms at most, fast-out easing. Honors reduced motion."
      >
        <MotionSample />
      </Section>
    </Page>
  );
}

const styles = StyleSheet.create({
  typeRow: { marginBottom: spacing.lg },
  swatches: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  swatch: { width: 160, gap: 2 },
  chip: { height: 56, borderWidth: 1, borderColor: colors.line, marginBottom: spacing.xs },
});

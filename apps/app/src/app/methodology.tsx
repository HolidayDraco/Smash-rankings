import Head from "expo-router/head";
import { StyleSheet, View } from "react-native";
import { AngledPanel, BodyText, DisplayText, colors, spacing } from "@sr/ui";
import { ActionLink } from "../components/ActionLink";
import { Markdown } from "../components/Markdown";
import { Page } from "../components/Page";
import { METHODOLOGY_MARKDOWN } from "../lib/methodologyCopy";

const TITLE = "How rankings work | Bracket Index";
const DESCRIPTION =
  "How Bracket Index rates Super Smash Bros. Ultimate players from start.gg sets: what counts, weekly ratings, the conservative score, and who is eligible.";
const ULTRANK_URL = "https://www.ssbwiki.com/UltRank";

export default function MethodologyPage() {
  return (
    <Page>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
      </Head>
      <View style={styles.column}>
        <DisplayText variant="h1">How rankings work</DisplayText>
        <BodyText muted style={styles.lead}>
          The numbers in plain English. An unofficial fan project, not affiliated with start.gg or
          any game publisher.
        </BodyText>
        <Markdown source={METHODOLOGY_MARKDOWN} />
      </View>
      <AngledPanel tone="surface" style={{ marginTop: spacing.xl }}>
        <DisplayText variant="h3" level={2}>
          Community rankings
        </DisplayText>
        <BodyText style={{ marginBottom: spacing.sm }}>
          Want a ranking built by community votes instead of a formula? Try UltRank.
        </BodyText>
        <ActionLink label="UltRank on the Smash Wiki" href={ULTRANK_URL} external />
      </AngledPanel>
    </Page>
  );
}

const styles = StyleSheet.create({
  column: { maxWidth: 720, width: "100%", alignSelf: "center", paddingHorizontal: spacing.lg },
  lead: { marginTop: spacing.sm, color: colors.inkMuted },
});

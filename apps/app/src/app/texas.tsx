import Head from "expo-router/head";
import { StyleSheet, View } from "react-native";
import { BodyText, DisplayText, colors, spacing } from "@sr/ui";
import { Page } from "../components/Page";

const TITLE = "Texas | Bracket Index";
const DESCRIPTION =
  "Texas Super Smash Bros. Ultimate city power rankings, computed from start.gg results. Coming soon.";

/** Placeholder for the Texas tab. A later PR adds the city power rankings. */
export default function Texas() {
  return (
    <Page>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
      </Head>
      <View style={styles.top}>
        <BodyText variant="label" color={colors.accent}>
          Super Smash Bros. Ultimate
        </BodyText>
        <DisplayText variant="h1">Texas</DisplayText>
        <BodyText variant="body">City power rankings are coming soon.</BodyText>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: spacing.lg, gap: spacing.md },
});

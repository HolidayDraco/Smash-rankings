import { Link } from "expo-router";
import Head from "expo-router/head";
import { StyleSheet, View } from "react-native";
import {
  AngledPanel,
  BodyText,
  DisplayText,
  colors,
  minTouchTarget,
  spacing,
  useFocusRing,
} from "@sr/ui";
import { Page } from "../components/Page";

const TITLE = "Smash Rankings";
const DESCRIPTION =
  "Live Super Smash Bros. Ultimate player rankings computed from start.gg results. Unofficial fan project.";

export default function Home() {
  const ring = useFocusRing();
  return (
    <Page>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
      </Head>
      <View style={styles.wrap}>
        <AngledPanel tone="accent">
          <BodyText variant="label" color={colors.white}>
            Super Smash Bros. Ultimate
          </BodyText>
          <DisplayText variant="display" level={1} color={colors.white}>
            Smash Rankings
          </DisplayText>
          <BodyText color={colors.white}>
            Player rankings from real set results. Coming soon.
          </BodyText>
        </AngledPanel>
        <BodyText muted style={styles.note}>
          This is an unofficial fan project. It is not affiliated with Nintendo or start.gg.
        </BodyText>
        <Link
          href="/style-guide"
          role="link"
          aria-label="Open the style guide"
          {...ring.handlers}
          style={[styles.cta, ring.style]}
        >
          <BodyText variant="label" color={colors.white}>
            Open the style guide
          </BodyText>
        </Link>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingTop: spacing.xl, paddingHorizontal: spacing.lg, gap: spacing.xl },
  note: { paddingHorizontal: spacing.lg },
  cta: {
    minHeight: minTouchTarget,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    backgroundColor: colors.ink,
    marginHorizontal: spacing.lg,
  },
});

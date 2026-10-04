import Head from "expo-router/head";
import { StyleSheet, View } from "react-native";
import { LAUNCH_REGIONS, STATE_NAMES } from "@sr/core";
import { BodyText, spacing } from "@sr/ui";
import {
  DashboardError,
  DashboardSkeleton,
  HeaderStrip,
  MoversSection,
  TopTenSection,
  UpsetsSection,
  WeekEventsSection,
  YearSection,
} from "../components/DashboardSections";
import { LastUpdated } from "../components/LastUpdated";
import { Page } from "../components/Page";
import { useDashboard } from "../lib/api";
import { formatWeekRange } from "../lib/format";

const REGION = STATE_NAMES[LAUNCH_REGIONS.states[0]] ?? LAUNCH_REGIONS.states[0];
const TITLE = "Dashboard | Smash Ultimate Rankings | Bracket Index";
const DESCRIPTION = `This week in ${REGION} Super Smash Bros. Ultimate: the top 10, biggest movers, upsets, events, and the year so far. Computed from start.gg results. Unofficial fan project.`;

/** The Dashboard tab: this week in Texas at a glance. The full leaderboard lives at /leaderboard. */
export default function Dashboard() {
  const dashboard = useDashboard();
  const data = dashboard.data;
  return (
    <Page>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
      </Head>
      <HeaderStrip
        title={data ? `${REGION} Smash, ${data.header.year}` : null}
        weekText={data ? formatWeekRange(data.header.weekStart, data.header.weekEnd) : null}
      >
        <LastUpdated />
      </HeaderStrip>
      {dashboard.isError ? (
        <DashboardError onRetry={() => void dashboard.refetch()} />
      ) : !data ? (
        <DashboardSkeleton region={REGION} />
      ) : (
        <>
          <TopTenSection region={REGION} data={data.top10} />
          <MoversSection data={data.movers} />
          <UpsetsSection data={data.upsets} />
          <WeekEventsSection events={data.weekEvents} total={data.weekEventCount} />
          <YearSection year={data.header.year} data={data.year} />
        </>
      )}
      <View style={styles.note}>
        <BodyText variant="bodySm" muted>
          Unofficial fan project. Not affiliated with Nintendo or start.gg.
        </BodyText>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  note: { paddingHorizontal: spacing.lg },
});

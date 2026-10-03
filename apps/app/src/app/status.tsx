import Head from "expo-router/head";
import { StyleSheet, View } from "react-native";
import type { JobStatus } from "@sr/core";
import { BodyText, DisplayText, colors, minTouchTarget, spacing } from "@sr/ui";
import { ActionLink } from "../components/ActionLink";
import { LastUpdated } from "../components/LastUpdated";
import { Page } from "../components/Page";
import { useStatus } from "../lib/api";
import { JOB_LABELS, jobState, type JobState } from "../lib/jobStatus";
import { relativeTime } from "../lib/format";

const TITLE = "Status | Bracket Index";
const DESCRIPTION =
  "When each Bracket Index data job last ran: finding events, pulling results, catching up history, and updating rankings.";

const BADGES: Record<JobState, { text: string; bg: string; fg: string; meaning: string }> = {
  ok: {
    text: "OK",
    bg: colors.surface,
    fg: colors.positive,
    meaning: "ran recently and finished fine.",
  },
  late: {
    text: "Late",
    bg: colors.signal,
    fg: colors.ink,
    meaning: "has not run as recently as expected. Rankings may be a little stale.",
  },
  failed: {
    text: "Failed",
    bg: colors.hot,
    fg: colors.white,
    meaning: "its last run hit an error. We retry on the next schedule.",
  },
  running: {
    text: "Running",
    bg: colors.accent,
    fg: colors.white,
    meaning: "is working right now.",
  },
  never: {
    text: "Not run yet",
    bg: colors.surface,
    fg: colors.inkMuted,
    meaning: "has not run yet.",
  },
};

function Badge({ state }: { state: JobState }) {
  const { text, bg, fg } = BADGES[state];
  return (
    <View style={[styles.badge, { backgroundColor: bg, borderColor: state === "ok" ? fg : bg }]}>
      <BodyText variant="label" color={fg} testID={`badge-${state}`}>
        {text}
      </BodyText>
    </View>
  );
}

function JobRow({ status, now }: { status: JobStatus; now: number }) {
  const state = jobState(status, now);
  const label = JOB_LABELS[status.job];
  const when = status.lastRunAt ? `Last run ${relativeTime(status.lastRunAt, now)}` : "Never run";
  const exact = status.lastRunAt ? `, at ${new Date(status.lastRunAt).toLocaleString()}` : "";
  return (
    <View
      role="listitem"
      aria-label={`${label}: ${BADGES[state].text}. ${when}${exact}.`}
      style={styles.row}
    >
      <View style={styles.flex}>
        <BodyText variant="stat">{label}</BodyText>
        <BodyText variant="bodySm" muted>
          {when}
        </BodyText>
      </View>
      <Badge state={state} />
    </View>
  );
}

export default function StatusPage() {
  const query = useStatus();
  const jobs = query.data?.jobs;
  return (
    <Page>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
      </Head>
      <View style={styles.column}>
        <DisplayText variant="h1">Status</DisplayText>
        <BodyText muted>Is the data fresh? This page updates every few minutes.</BodyText>
        <LastUpdated />
        {query.isError ? (
          <View role="alert" style={styles.gap}>
            <BodyText>We could not load the status. Check your connection and try again.</BodyText>
            <ActionLink label="Try again" onPress={() => void query.refetch()} solid />
          </View>
        ) : jobs ? (
          <View role="list" aria-label="Job status">
            {jobs.map((job) => (
              <JobRow key={job.job} status={job} now={query.dataUpdatedAt} />
            ))}
          </View>
        ) : (
          <View aria-busy role="status" aria-label="Loading status">
            {Array.from({ length: 4 }, (_, i) => (
              <View key={i} aria-hidden testID="skeleton-row" style={styles.row}>
                <View style={[styles.flex, styles.gap]}>
                  <View style={[styles.bar, { width: "40%" }]} />
                  <View style={[styles.bar, { width: "25%", height: 8 }]} />
                </View>
                <View style={[styles.bar, { width: 72, height: 28 }]} />
              </View>
            ))}
          </View>
        )}
        <DisplayText variant="h2" style={{ marginTop: spacing.xl }}>
          What the badges mean
        </DisplayText>
        <View role="list" aria-label="Badge legend" style={styles.gap}>
          {(Object.keys(BADGES) as JobState[]).map((state) => (
            <View key={state} role="listitem" style={styles.legend}>
              <Badge state={state} />
              <BodyText variant="bodySm" style={styles.flex}>
                This job {BADGES[state].meaning}
              </BodyText>
            </View>
          ))}
        </View>
        <BodyText variant="bodySm" muted>
          Pull results and Update rankings run every 2 hours (hourly Friday to Monday), so Late
          means over 4 hours. Find new events and Catch up history run daily, so Late means over 26
          hours.
        </BodyText>
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  column: {
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  gap: { gap: spacing.sm },
  flex: { flex: 1 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: minTouchTarget + 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
  legend: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  badge: {
    minWidth: 96,
    minHeight: 32,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    transform: [{ skewX: "-12deg" }],
  },
  bar: { height: 12, backgroundColor: colors.surface },
});

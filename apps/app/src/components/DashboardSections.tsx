import { Link } from "expo-router";
import type { ReactNode } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { DashboardResponse } from "@sr/core";
import {
  AngledPanel,
  BodyText,
  DisplayText,
  colors,
  minTouchTarget,
  spacing,
  useFocusRing,
} from "@sr/ui";
import {
  describeUpset,
  formatEventDay,
  formatSetScore,
  moreEventsText,
  playerHref,
} from "../lib/format";
import { ActionLink } from "./ActionLink";
import { PlayerRow, SkeletonRow } from "./PlayerRow";
import { Section } from "./Section";

type Player = DashboardResponse["upsets"][number]["winner"];

/** A tidy one-line message for a section with nothing in it yet. */
function Empty({ children }: { children: string }) {
  return (
    <View style={styles.empty}>
      <BodyText muted>{children}</BodyText>
    </View>
  );
}

/** A player's tag as a link to their page, with a 44 px target. */
function PlayerLink({ player, strong }: { player: Player; strong?: boolean }) {
  const ring = useFocusRing();
  return (
    <Link href={playerHref(player.playerId, player.gamerTag)} asChild>
      <Pressable
        role="link"
        aria-label={player.prefix ? `${player.prefix} ${player.gamerTag}` : player.gamerTag}
        {...ring.handlers}
        style={StyleSheet.flatten([styles.playerLink, ring.style])}
      >
        <BodyText variant="stat" color={strong ? colors.accent : colors.ink} numberOfLines={1}>
          {player.prefix ? (
            <BodyText variant="bodySm" muted>
              {player.prefix}{" "}
            </BodyText>
          ) : null}
          {player.gamerTag}
        </BodyText>
      </Pressable>
    </Link>
  );
}

export function TopTenSection({
  region,
  data,
}: {
  region: string;
  data: DashboardResponse["top10"];
}) {
  return (
    <Section title={`${region} Top 10`} note="Ranked by score. Change is versus last week.">
      {data.length === 0 ? (
        <Empty>No players are ranked yet. Check back after the next update.</Empty>
      ) : (
        <View role="list" aria-label={`${region} top 10 players`}>
          {data.map((entry) => (
            <PlayerRow
              key={entry.playerId}
              playerId={entry.playerId}
              rank={entry.rank}
              tag={entry.gamerTag}
              prefix={entry.prefix}
              score={entry.conservativeScore}
              delta={entry.rankDelta7d}
              deltaFormat="week"
            />
          ))}
        </View>
      )}
      <ActionLink
        label="Full leaderboard and player search"
        text="Full leaderboard →"
        href="/leaderboard"
      />
    </Section>
  );
}

function MoverList({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: DashboardResponse["movers"]["climbers"];
  empty: string;
}) {
  return (
    <View style={styles.moverCol}>
      <DisplayText variant="h3" level={3}>
        {title}
      </DisplayText>
      {rows.length === 0 ? (
        <Empty>{empty}</Empty>
      ) : (
        <View role="list" aria-label={title}>
          {rows.map((row) => (
            <PlayerRow
              key={row.playerId}
              playerId={row.playerId}
              rank={row.rank}
              tag={row.gamerTag}
              prefix={row.prefix}
              delta={row.rankDelta7d}
              deltaFormat="week"
            />
          ))}
        </View>
      )}
    </View>
  );
}

export function MoversSection({ data }: { data: DashboardResponse["movers"] }) {
  return (
    <Section title="This week's movers" note="Biggest rank changes in the last 7 days.">
      <View style={styles.moverWrap}>
        <MoverList title="Climbers" rows={data.climbers} empty="No climbers yet this week." />
        <MoverList title="Fallers" rows={data.fallers} empty="No fallers yet this week." />
      </View>
    </Section>
  );
}

export function UpsetsSection({ data }: { data: DashboardResponse["upsets"] }) {
  return (
    <Section title="Upsets of the week" note="A lower-rated player beat a higher-rated one.">
      {data.length === 0 ? (
        <Empty>No upsets yet this week.</Empty>
      ) : (
        <View role="list" aria-label="Upsets of the week" style={styles.cards}>
          {data.map((upset) => (
            <View key={upset.setId} role="listitem" style={styles.card}>
              <View
                role="group"
                aria-label={describeUpset(upset.winner.gamerTag, upset.loser.gamerTag, upset.score)}
                style={styles.sentence}
              >
                <PlayerLink player={upset.winner} strong />
                <BodyText>beat</BodyText>
                <PlayerLink player={upset.loser} />
                {upset.score ? (
                  <BodyText variant="stat">{formatSetScore(upset.score)}</BodyText>
                ) : null}
              </View>
              <BodyText variant="bodySm" muted>
                {upset.eventName} · {upset.tournamentName}
              </BodyText>
              <View style={styles.gap}>
                <BodyText variant="label" color={colors.ink}>
                  Rating gap {upset.ratingGap}
                </BodyText>
              </View>
            </View>
          ))}
        </View>
      )}
    </Section>
  );
}

export function WeekEventsSection({
  events,
  total,
}: {
  events: DashboardResponse["weekEvents"];
  total: number;
}) {
  const more = moreEventsText(total, events.length);
  return (
    <Section title="This week's events">
      {events.length === 0 ? (
        <Empty>No events yet this week.</Empty>
      ) : (
        <View role="list" aria-label="This week's events" style={styles.cards}>
          {events.map((event) => (
            <View key={event.eventId} role="listitem" style={styles.card}>
              <DisplayText variant="h3" level={3} style={styles.eventTitle}>
                {event.eventName}
              </DisplayText>
              <BodyText variant="bodySm" muted>
                {event.tournamentName}
              </BodyText>
              <BodyText variant="bodySm">
                {[
                  event.city,
                  formatEventDay(event.startAt),
                  event.numEntrants === null ? null : `${event.numEntrants} entrants`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </BodyText>
              {event.winner ? (
                <View style={styles.sentence}>
                  <BodyText variant="label" muted>
                    Winner
                  </BodyText>
                  <PlayerLink player={event.winner} strong />
                </View>
              ) : (
                <BodyText variant="bodySm" muted style={styles.tbd}>
                  Winner TBD
                </BodyText>
              )}
              <ActionLink
                external
                href={event.startggUrl}
                label={`${event.eventName} on start.gg`}
                text="View on start.gg ↗"
              />
            </View>
          ))}
        </View>
      )}
      {more ? (
        <BodyText variant="stat" style={styles.more}>
          {more}
        </BodyText>
      ) : null}
    </Section>
  );
}

function Tile({ value, label }: { value: number; label: string }) {
  return (
    <View role="listitem" style={styles.tile}>
      <DisplayText variant="h1" level={null} color={colors.accent}>
        {value.toLocaleString("en-US")}
      </DisplayText>
      <BodyText variant="label" muted>
        {label}
      </BodyText>
    </View>
  );
}

export function YearSection({ year, data }: { year: number; data: DashboardResponse["year"] }) {
  return (
    <Section title="Year at a glance" note={`Counted events so far in ${year}.`}>
      {data.eventCount === 0 ? (
        <Empty>No counted events yet this year.</Empty>
      ) : (
        <>
          <View role="list" aria-label="Year totals" style={styles.tiles}>
            <Tile value={data.eventCount} label="Events" />
            <Tile value={data.totalEntrants} label="Total entrants" />
            <Tile value={data.uniquePlayers} label="Unique players" />
          </View>
          <View style={styles.cards}>
            {data.biggestEvent ? (
              <View role="group" aria-label="Biggest event" style={styles.card}>
                <BodyText variant="label" muted>
                  Biggest event
                </BodyText>
                <DisplayText variant="h3" level={null} style={styles.eventTitle}>
                  {data.biggestEvent.eventName}
                </DisplayText>
                <BodyText variant="bodySm" muted>
                  {data.biggestEvent.tournamentName} · {data.biggestEvent.numEntrants} entrants
                </BodyText>
                <ActionLink
                  external
                  href={data.biggestEvent.startggUrl}
                  label={`${data.biggestEvent.eventName} on start.gg`}
                  text="View on start.gg ↗"
                />
              </View>
            ) : null}
            {data.mostWins ? (
              <View role="group" aria-label="Most event wins" style={styles.card}>
                <BodyText variant="label" muted>
                  Most event wins
                </BodyText>
                <PlayerLink player={data.mostWins.player} strong />
                <BodyText variant="bodySm" muted>
                  {data.mostWins.wins} {data.mostWins.wins === 1 ? "win" : "wins"} this year
                </BodyText>
              </View>
            ) : null}
          </View>
        </>
      )}
    </Section>
  );
}

/** Header strip: "Texas Smash, 2026", the week, and the last-updated badge (passed in). */
export function HeaderStrip({
  title,
  weekText,
  children,
}: {
  title: string | null;
  weekText: string | null;
  children: ReactNode;
}) {
  return (
    <View style={styles.header}>
      <BodyText variant="label" color={colors.accent} style={styles.pad}>
        Super Smash Bros. Ultimate
      </BodyText>
      <DisplayText variant="h3" level={1} style={styles.pad}>
        Dashboard
      </DisplayText>
      <AngledPanel tone="ink" stripe style={styles.panel}>
        {title ? (
          <DisplayText variant="h1" level={2} color={colors.white}>
            {title}
          </DisplayText>
        ) : (
          <View aria-hidden style={[styles.bar, styles.barDark, { width: "70%", height: 32 }]} />
        )}
        {weekText ? (
          <BodyText variant="stat" color={colors.white} style={styles.week}>
            {weekText}
          </BodyText>
        ) : (
          <View aria-hidden style={[styles.bar, styles.barDark, { width: "50%", marginTop: 8 }]} />
        )}
      </AngledPanel>
      <View style={styles.pad}>{children}</View>
    </View>
  );
}

function BarBlock({ lines, height = 16 }: { lines: number; height?: number }) {
  return (
    <View aria-hidden style={{ gap: spacing.sm }}>
      {Array.from({ length: lines }, (_, index) => (
        <View key={index} style={[styles.bar, { width: index % 2 ? "60%" : "90%", height }]} />
      ))}
    </View>
  );
}

/** Same grey-bar skeleton style as the leaderboard rows, one block per section. */
export function DashboardSkeleton({ region }: { region: string }) {
  return (
    <View aria-busy aria-label="Loading the dashboard">
      <Section title={`${region} Top 10`}>
        {Array.from({ length: 10 }, (_, index) => (
          <SkeletonRow key={index} />
        ))}
      </Section>
      {["This week's movers", "Upsets of the week", "This week's events", "Year at a glance"].map(
        (title) => (
          <Section key={title} title={title}>
            <View style={styles.card}>
              <BarBlock lines={3} height={18} />
            </View>
          </Section>
        ),
      )}
    </View>
  );
}

export function DashboardError({ onRetry }: { onRetry: () => void }) {
  const ring = useFocusRing();
  return (
    <View role="alert" style={styles.errorBox}>
      <BodyText variant="bodySm">
        We could not load the dashboard. Check your connection and try again.
      </BodyText>
      <Pressable
        role="button"
        aria-label="Try again: load the dashboard"
        onPress={onRetry}
        {...ring.handlers}
        style={StyleSheet.flatten([styles.retry, ring.style])}
      >
        <BodyText variant="label" color={colors.white}>
          Try again
        </BodyText>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: spacing.md, paddingBottom: spacing.xl },
  pad: { paddingHorizontal: spacing.lg },
  panel: { marginVertical: spacing.sm },
  week: { marginTop: spacing.sm },
  empty: { paddingVertical: spacing.lg },
  playerLink: { minHeight: minTouchTarget, minWidth: minTouchTarget, justifyContent: "center" },
  moverWrap: { flexDirection: "row", flexWrap: "wrap", columnGap: spacing.xl, rowGap: spacing.lg },
  moverCol: { flexGrow: 1, flexBasis: 300, minWidth: 0, gap: spacing.xs },
  cards: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  card: {
    flexGrow: 1,
    flexBasis: 300,
    minWidth: 0,
    gap: spacing.xs,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderLeftWidth: 4,
    borderLeftColor: colors.accent,
  },
  sentence: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.sm },
  gap: {
    alignSelf: "flex-start",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    backgroundColor: colors.signal,
  },
  eventTitle: { textTransform: "none" },
  tbd: { paddingVertical: spacing.sm },
  more: { paddingTop: spacing.md },
  tiles: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, marginBottom: spacing.lg },
  tile: {
    flexGrow: 1,
    flexBasis: 100,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderTopWidth: 4,
    borderTopColor: colors.hot,
  },
  bar: { height: 14, backgroundColor: colors.line },
  barDark: { backgroundColor: colors.inkMuted },
  errorBox: { padding: spacing.lg, gap: spacing.md, alignItems: "flex-start" },
  retry: {
    minHeight: minTouchTarget,
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.ink,
  },
});

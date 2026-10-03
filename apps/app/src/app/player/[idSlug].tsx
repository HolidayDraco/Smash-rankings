import { useEffect, useState } from "react";
import { Link, useLocalSearchParams } from "expo-router";
import Head from "expo-router/head";
import { Linking, Platform, Pressable, StyleSheet, View, type PressableProps } from "react-native";
import type { PlayerResponse } from "@sr/core";
import {
  AngledPanel,
  BodyText,
  DisplayText,
  colors,
  minTouchTarget,
  spacing,
  useFocusRing,
} from "@sr/ui";
import { LastUpdated } from "../../components/LastUpdated";
import { Page } from "../../components/Page";
import { SkeletonRow } from "../../components/PlayerRow";
import { usePlayer } from "../../lib/api";
import { describeNotRanked, formatDate, formatPlacement, parsePlayerId } from "../../lib/format";

/** Text button/link with a 44 px target and visible focus. `external` opens in a new tab or the browser. */
function ActionLink({
  label,
  text,
  href,
  external,
  onPress,
  solid,
}: {
  label: string;
  /** Visible text when it differs from the accessible label (e.g. an arrow that screen readers skip). */
  text?: string;
  href?: string;
  external?: boolean;
  onPress?: PressableProps["onPress"];
  solid?: boolean;
}) {
  const ring = useFocusRing();
  const webProps =
    Platform.OS === "web" && href
      ? ({
          href,
          hrefAttrs: external ? { target: "_blank", rel: "noopener noreferrer" } : undefined,
        } as object)
      : {};
  const press =
    external && Platform.OS !== "web" && href ? () => void Linking.openURL(href) : onPress;
  const node = (
    <Pressable
      role={onPress && !href ? "button" : "link"}
      aria-label={external && Platform.OS === "web" ? `${label} (opens in a new tab)` : label}
      onPress={press}
      {...ring.handlers}
      {...webProps}
      style={StyleSheet.flatten([styles.action, solid && styles.solid, ring.style])}
    >
      <BodyText variant="label" color={solid ? colors.white : colors.accent}>
        {text ?? label}
      </BodyText>
    </Pressable>
  );
  return href && !external ? (
    <Link href={href as "/"} asChild>
      {node}
    </Link>
  ) : (
    node
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <DisplayText variant="h2" level={null}>
        {value}
      </DisplayText>
      <BodyText variant="label" muted>
        {label}
      </BodyText>
    </View>
  );
}

function PlayerDetails({ player }: { player: PlayerResponse }) {
  const { rating, ratingDeviation: rd } = player;
  const margin = rd === null ? null : Math.round(rd * 2);
  return (
    <>
      <View style={styles.pad}>
        <DisplayText variant="h1">
          {player.prefix ? (
            <BodyText variant="bodySm" muted>
              {player.prefix}{" "}
            </BodyText>
          ) : null}
          {player.gamerTag}
        </DisplayText>
        {player.countryCode ? (
          <BodyText variant="label" muted aria-label={`Country ${player.countryCode}`}>
            {player.countryCode}
          </BodyText>
        ) : null}
        <LastUpdated />
      </View>
      <AngledPanel tone="ink" style={{ marginTop: spacing.lg }}>
        <BodyText variant="label" color={colors.white}>
          Rank
        </BodyText>
        <DisplayText variant="display" level={null} color={colors.white}>
          {player.rank === null ? "Not yet ranked" : `#${player.rank}`}
        </DisplayText>
      </AngledPanel>
      <View style={[styles.pad, { gap: spacing.xs }]}>
        {player.rank === null && player.notRankedReason ? (
          <BodyText role="status">{describeNotRanked(player.notRankedReason)}</BodyText>
        ) : null}
        {player.conservativeScore !== null ? (
          <BodyText variant="stat">
            {player.rank === null ? "Provisional score" : "Score"} {player.conservativeScore}
          </BodyText>
        ) : null}
        {rating !== null && margin !== null ? (
          <>
            <BodyText variant="stat">
              Rating {Math.round(rating)} ± {margin}
            </BodyText>
            <BodyText variant="bodySm" muted>
              Likely between {Math.round(rating) - margin} and {Math.round(rating) + margin} · a
              smaller ± means more certain
            </BodyText>
          </>
        ) : null}
      </View>
      <View role="group" aria-label="Stats" style={[styles.pad, styles.stats]}>
        <Stat label="Sets rated" value={String(player.ratedSets)} />
        <Stat label="Events" value={String(player.qualifyingEvents)} />
        <Stat label="12-month W–L" value={`${player.setRecord.wins}–${player.setRecord.losses}`} />
      </View>
      <View style={styles.pad}>
        <DisplayText variant="h2">Recent results</DisplayText>
        {player.recentResults.length === 0 ? (
          <BodyText muted>No recent results yet.</BodyText>
        ) : (
          <View role="list" aria-label="Recent results">
            {player.recentResults.map((result) => (
              <View key={result.eventId} role="listitem" style={styles.result}>
                <View style={{ flex: 1 }}>
                  <BodyText variant="stat">{result.eventName}</BodyText>
                  <BodyText variant="bodySm" muted>
                    {result.tournamentName} · {formatDate(result.date)}
                  </BodyText>
                </View>
                <BodyText variant="stat">
                  {formatPlacement(result.placement, result.entrants)}
                </BodyText>
              </View>
            ))}
          </View>
        )}
        {player.startggUrl ? (
          <ActionLink label="View on start.gg" href={player.startggUrl} external />
        ) : null}
      </View>
    </>
  );
}

export default function PlayerPage() {
  const { idSlug } = useLocalSearchParams<{ idSlug: string }>();
  const playerId = parsePlayerId(idSlug);
  const query = usePlayer(playerId);
  const player = query.data;
  const title = player
    ? `${player.gamerTag} | Smash Ultimate Rankings | Bracket Index`
    : "Player | Bracket Index";
  const description = player
    ? `${player.gamerTag}: ${player.rank === null ? "not yet ranked" : `ranked #${player.rank}`} in Super Smash Bros. Ultimate. Results from start.gg.`
    : "Super Smash Bros. Ultimate player profile.";
  // The static HTML is built with the literal "[idSlug]", so wait for the browser before trusting the id.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const idKnown = mounted && !!idSlug && idSlug !== "[idSlug]";
  const notFound = idKnown && (playerId === null || (query.isSuccess && player === null));

  return (
    <Page>
      <Head>
        <title>{title}</title>
        <meta name="description" content={description} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
      </Head>
      <View style={styles.pad}>
        <ActionLink label="Back to leaderboard" text="← Leaderboard" href="/" />
      </View>
      {notFound ? (
        <View role="alert" style={styles.pad}>
          <DisplayText variant="h1">Player not found</DisplayText>
          <BodyText>We could not find that player. They may not be ranked yet.</BodyText>
        </View>
      ) : query.isError ? (
        <View role="alert" style={styles.pad}>
          <DisplayText variant="h1">Couldn&apos;t load player</DisplayText>
          <BodyText>We could not load this player. Check your connection and try again.</BodyText>
          <ActionLink label="Try again" onPress={() => void query.refetch()} solid />
        </View>
      ) : player ? (
        <PlayerDetails player={player} />
      ) : (
        <View aria-busy role="status" aria-label="Loading player">
          {Array.from({ length: 6 }, (_, index) => (
            <SkeletonRow key={index} />
          ))}
        </View>
      )}
    </Page>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: spacing.lg, gap: spacing.md, paddingVertical: spacing.sm },
  action: { minHeight: minTouchTarget, justifyContent: "center", alignSelf: "flex-start" },
  solid: { backgroundColor: colors.ink, paddingHorizontal: spacing.xl },
  stats: { flexDirection: "row", gap: spacing.xl, flexWrap: "wrap" },
  stat: { minWidth: 88 },
  result: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    minHeight: minTouchTarget + 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
  },
});

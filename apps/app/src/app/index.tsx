import Head from "expo-router/head";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { SEARCH_MIN_QUERY_LENGTH } from "@sr/core";
import { BodyText, DisplayText, colors, spacing } from "@sr/ui";
import { LastUpdated } from "../components/LastUpdated";
import { Page } from "../components/Page";
import { PlayerList } from "../components/PlayerList";
import { SearchBox } from "../components/SearchBox";
import { useLeaderboard, useSearch } from "../lib/api";
import { useDebouncedValue } from "../lib/useDebouncedValue";

const TITLE = "Smash Ultimate Rankings | Bracket Index";
const DESCRIPTION =
  "Live Super Smash Bros. Ultimate player rankings computed from start.gg results. Unofficial fan project.";

export default function Leaderboard() {
  const [text, setText] = useState("");
  const query = useDebouncedValue(text.trim().toLowerCase(), 250);
  const searching = query.length >= SEARCH_MIN_QUERY_LENGTH;
  const leaderboard = useLeaderboard();
  const search = useSearch(query);
  // While the debounce catches up with typing, keep showing the search view, not the leaderboard.
  const typedEnough = text.trim().length >= SEARCH_MIN_QUERY_LENGTH;

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
        <DisplayText variant="h1">Rankings</DisplayText>
        <LastUpdated />
        <SearchBox value={text} onChange={setText} />
        {text.trim().length === 1 ? (
          <BodyText variant="bodySm" muted>
            Type at least {SEARCH_MIN_QUERY_LENGTH} letters to search.
          </BodyText>
        ) : null}
      </View>
      {typedEnough ? (
        <PlayerList
          label={`search results for ${query}`}
          status={
            searching && !search.isPending ? (search.isError ? "error" : "success") : "pending"
          }
          rows={(search.data?.results ?? []).map((player) => ({
            playerId: player.playerId,
            rank: player.rank,
            tag: player.gamerTag,
            prefix: player.prefix,
          }))}
          emptyText="No players match that search."
          onRetry={() => void search.refetch()}
        />
      ) : (
        <PlayerList
          showHeader
          label="the top 100 leaderboard"
          status={leaderboard.status}
          rows={(leaderboard.data?.entries ?? []).map((entry) => ({
            playerId: entry.playerId,
            rank: entry.rank,
            tag: entry.gamerTag,
            prefix: entry.prefix,
            country: entry.countryCode,
            score: entry.conservativeScore,
            delta: entry.rankDelta7d,
          }))}
          emptyText="No players are ranked yet. Check back after the next update."
          onRetry={() => void leaderboard.refetch()}
        />
      )}
      <BodyText variant="bodySm" muted style={styles.note}>
        Unofficial fan project. Not affiliated with Nintendo or start.gg.
      </BodyText>
    </Page>
  );
}

const styles = StyleSheet.create({
  note: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  top: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
});

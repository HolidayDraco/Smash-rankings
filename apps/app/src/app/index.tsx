import Head from "expo-router/head";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { SEARCH_MIN_QUERY_LENGTH } from "@sr/core";
import { BodyText, DisplayText, colors, spacing } from "@sr/ui";
import { LastUpdated } from "../components/LastUpdated";
import { Page } from "../components/Page";
import { PlayerList } from "../components/PlayerList";
import { SearchBox } from "../components/SearchBox";
import { ApiError, useLeaderboard, useSearch } from "../lib/api";
import { useDebouncedValue } from "../lib/useDebouncedValue";

const TITLE = "Dashboard | Smash Ultimate Rankings | Bracket Index";
const DESCRIPTION =
  "Live Super Smash Bros. Ultimate player rankings computed from start.gg results. Unofficial fan project.";

/** Control characters (from pasted text) are dropped; the rest is trimmed and lower-cased. */
// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/g;
const normalizeQuery = (raw: string) => raw.replace(CONTROL_CHARACTERS, "").trim().toLowerCase();

export default function Leaderboard() {
  const [text, setText] = useState("");
  const normalized = normalizeQuery(text);
  const query = useDebouncedValue(normalized, 250);
  const leaderboard = useLeaderboard();
  const search = useSearch(query);
  // While the debounce catches up with typing, keep showing the search view, not the leaderboard.
  const typedEnough = normalized.length >= SEARCH_MIN_QUERY_LENGTH;
  const searchStatus = search.isError ? "error" : search.data ? "success" : "pending";
  const settled = searchStatus === "success" && !search.isPlaceholderData && query === normalized;
  const count = search.data?.results.length ?? 0;
  const liveMessage = !text.trim()
    ? ""
    : !typedEnough
      ? `Type at least ${SEARCH_MIN_QUERY_LENGTH} letters to search.`
      : searchStatus === "error"
        ? "Search failed."
        : !settled
          ? "Searching…"
          : count === 0
            ? "No players match that search."
            : `${count} ${count === 1 ? "player" : "players"} found`;

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
        <DisplayText variant="h1">Dashboard</DisplayText>
        <LastUpdated />
        <SearchBox value={text} onChange={setText} />
        <View role="status" aria-live="polite" testID="search-status" style={styles.live}>
          <BodyText variant="bodySm" muted>
            {liveMessage}
          </BodyText>
        </View>
      </View>
      {typedEnough ? (
        <PlayerList
          label={`search results for ${query}`}
          status={searchStatus}
          errorText={
            search.error instanceof ApiError && search.error.status < 500
              ? "That search was not accepted. Try different letters."
              : undefined
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
  live: { minHeight: 20 },
  note: { paddingHorizontal: spacing.lg, paddingTop: spacing.lg },
  top: { paddingHorizontal: spacing.lg, paddingBottom: spacing.lg, gap: spacing.md },
});

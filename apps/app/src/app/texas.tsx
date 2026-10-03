import Head from "expo-router/head";
import { useEffect, useMemo, useState } from "react";
import { Platform, StyleSheet, View } from "react-native";
import { texasScenes } from "@sr/core/texas-scenes";
import { BodyText, DisplayText, colors, spacing } from "@sr/ui";
import { Page } from "../components/Page";
import { SceneCard } from "../components/SceneCard";
import { SearchBox } from "../components/SearchBox";
import { PINS_STORAGE_KEY, arrangeScenes, parsePins, togglePin } from "../lib/scenes";

const TITLE = "Texas local power rankings | Bracket Index";
const DESCRIPTION =
  "Local Smash Ultimate power rankings for Texas cities, as posted by each scene's organizers. Pin your city and see the full list.";

const scenes = texasScenes.scenes;
const sceneIds = scenes.map((scene) => scene.id);

/** localStorage on web only; every access is guarded because storage can be blocked. */
function readPins(): Set<string> {
  if (Platform.OS !== "web") return new Set();
  try {
    return parsePins(globalThis.localStorage?.getItem(PINS_STORAGE_KEY) ?? null, sceneIds);
  } catch {
    return new Set();
  }
}

function writePins(pins: ReadonlySet<string>) {
  if (Platform.OS !== "web") return;
  try {
    globalThis.localStorage?.setItem(PINS_STORAGE_KEY, JSON.stringify([...pins]));
  } catch {
    // Storage unavailable (private mode, blocked): pins just last for this visit.
  }
}

export default function TexasPage() {
  const [query, setQuery] = useState("");
  const [pins, setPins] = useState<ReadonlySet<string>>(() => new Set());
  const [openId, setOpenId] = useState<string | null>(null);

  // Read saved pins after mount so the server-rendered HTML and first client render match.
  useEffect(() => {
    setPins(readPins());
  }, []);

  const visible = useMemo(() => arrangeScenes(scenes, pins, query), [pins, query]);
  const trimmed = query.trim();

  return (
    <Page>
      <Head>
        <title>{TITLE}</title>
        <meta name="description" content={DESCRIPTION} />
        <meta property="og:title" content={TITLE} />
        <meta property="og:description" content={DESCRIPTION} />
      </Head>
      <View style={styles.column}>
        <DisplayText variant="h1">Texas</DisplayText>
        <BodyText muted style={styles.lead}>
          Local power rankings, as posted by each scene&apos;s organizers.
        </BodyText>
        <View style={styles.search}>
          <SearchBox value={query} onChange={setQuery} label="Search cities" />
        </View>
        <BodyText variant="bodySm" muted style={styles.credit}>
          Rankings from local organizers
        </BodyText>
        {visible.length === 0 ? (
          <View role="status" style={styles.empty}>
            <BodyText>No scenes match &quot;{trimmed}&quot;</BodyText>
          </View>
        ) : (
          <View role="list" aria-label="Texas cities" style={styles.list}>
            {visible.map((scene) => (
              <SceneCard
                key={scene.id}
                scene={scene}
                pinned={pins.has(scene.id)}
                expanded={openId === scene.id}
                onToggleExpanded={() => setOpenId(openId === scene.id ? null : scene.id)}
                onTogglePin={() => {
                  const next = togglePin(pins, scene.id);
                  setPins(next);
                  writePins(next);
                }}
              />
            ))}
          </View>
        )}
      </View>
    </Page>
  );
}

const styles = StyleSheet.create({
  column: { maxWidth: 720, width: "100%", alignSelf: "center", paddingHorizontal: spacing.lg },
  lead: { marginTop: spacing.sm, color: colors.inkMuted },
  search: { marginTop: spacing.lg },
  credit: { marginTop: spacing.md, marginBottom: spacing.sm },
  list: { gap: spacing.sm },
  empty: { paddingVertical: spacing.xl },
});

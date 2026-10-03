import { Pressable, StyleSheet, View } from "react-native";
import type { Scene } from "@sr/core";
import { BodyText, DisplayText, colors, minTouchTarget, spacing, useFocusRing } from "@sr/ui";
import { ActionLink } from "./ActionLink";

/** One Texas city: a pin star, and a button that expands the posted ranking inline. */
export function SceneCard({
  scene,
  pinned,
  expanded,
  onToggleExpanded,
  onTogglePin,
}: {
  scene: Scene;
  pinned: boolean;
  expanded: boolean;
  onToggleExpanded: () => void;
  onTogglePin: () => void;
}) {
  const header = useFocusRing();
  const star = useFocusRing();
  const panelId = `scene-${scene.id}`;
  return (
    <View role="listitem" style={[styles.card, pinned && styles.cardPinned]}>
      <View style={styles.headerRow}>
        <Pressable
          role="button"
          aria-expanded={expanded}
          aria-controls={panelId}
          aria-label={`${scene.city}, ${scene.players.length} ranked players`}
          onPress={onToggleExpanded}
          {...header.handlers}
          style={[styles.headerButton, header.style]}
        >
          <View style={styles.titleGroup}>
            <DisplayText variant="h3" level={null} style={styles.city}>
              {scene.city}
            </DisplayText>
            {scene.type === "calculated" ? (
              <BodyText variant="bodySm" muted>
                Calculated ranking
              </BodyText>
            ) : null}
          </View>
          <BodyText variant="label" color={colors.accent} aria-hidden>
            {expanded ? "Hide" : "View"}
          </BodyText>
        </Pressable>
        <Pressable
          role="button"
          aria-pressed={pinned}
          aria-label={`${pinned ? "Unpin" : "Pin"} ${scene.city}`}
          onPress={onTogglePin}
          {...star.handlers}
          style={[styles.star, star.style]}
        >
          <BodyText variant="stat" aria-hidden color={pinned ? colors.accent : colors.inkMuted}>
            {pinned ? "★" : "☆"}
          </BodyText>
        </Pressable>
      </View>
      {expanded ? (
        <View nativeID={panelId} style={styles.body}>
          <BodyText variant="label">{scene.rankingName}</BodyText>
          {scene.type === "calculated" ? (
            <BodyText variant="bodySm" muted>
              Calculated ranking: worked out by a formula, not voted on by a panel.
            </BodyText>
          ) : null}
          <BodyText variant="bodySm" muted>
            {scene.updated ? `${scene.season} · Updated ${scene.updated}` : scene.season}
          </BodyText>
          {scene.sourceUrl ? (
            <ActionLink
              label={`Source for ${scene.city}`}
              text="Source"
              href={scene.sourceUrl}
              external
            />
          ) : null}
          <View role="list" aria-label={`${scene.city} ranking`} style={styles.players}>
            {scene.players.map((player, index) => (
              <View key={`${player.rank}-${index}`} role="listitem" style={styles.player}>
                <BodyText variant="stat" color={colors.accent} style={styles.rank}>
                  {player.rank}
                </BodyText>
                <BodyText>{player.name}</BodyText>
              </View>
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderColor: colors.line,
    borderLeftWidth: 4,
    borderLeftColor: colors.line,
    backgroundColor: colors.white,
  },
  cardPinned: { borderLeftColor: colors.accent },
  headerRow: { flexDirection: "row", alignItems: "center" },
  headerButton: {
    flex: 1,
    minHeight: minTouchTarget + 8,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
  },
  titleGroup: { flexShrink: 1 },
  city: {},
  star: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    alignItems: "center",
    justifyContent: "center",
  },
  body: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.md,
  },
  players: { marginTop: spacing.sm },
  player: {
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface,
  },
  rank: { minWidth: 36, textAlign: "right" },
});

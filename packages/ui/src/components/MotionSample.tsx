import { useCallback, useEffect, useRef } from "react";
import { Animated, Easing, Platform, Pressable, StyleSheet, View } from "react-native";
import { useFocusRing } from "../hooks/useFocusRing";
import { useReducedMotion } from "../hooks/useReducedMotion";
import { colors, durations, easing, minTouchTarget, spacing, staggerMs } from "../tokens";
import { BodyText } from "./BodyText";

const BARS = [0.92, 0.7, 0.55, 0.38] as const;
const useNativeDriver = Platform.OS !== "web";

/** Staggered bar slide-in. Replays on press. With reduced motion, bars appear instantly. */
export function MotionSample() {
  const reduced = useReducedMotion();
  const ring = useFocusRing();
  const values = useRef(BARS.map(() => new Animated.Value(0))).current;

  const running = useRef<Animated.CompositeAnimation | null>(null);

  const play = useCallback(() => {
    if (reduced === null) return; // preference not known yet
    running.current?.stop();
    values.forEach((v) => v.setValue(reduced ? 1 : 0));
    if (reduced) return;
    running.current = Animated.stagger(
      staggerMs,
      values.map((v) =>
        Animated.timing(v, {
          toValue: 1,
          duration: durations.slow,
          easing: Easing.bezier(...easing.out),
          useNativeDriver,
        }),
      ),
    );
    running.current.start();
  }, [reduced, values]);

  useEffect(() => {
    play();
    return () => running.current?.stop();
  }, [play]);

  return (
    <View>
      <View style={styles.bars} aria-hidden>
        {BARS.map((width, i) => (
          <View key={width} style={styles.track}>
            <Animated.View
              style={[
                styles.bar,
                {
                  width: `${width * 100}%`,
                  backgroundColor: i === 0 ? colors.accent : colors.ink,
                  opacity: values[i] ?? 1,
                  transform: [
                    {
                      translateX: (values[i] ?? new Animated.Value(1)).interpolate({
                        inputRange: [0, 1],
                        outputRange: [-48, 0],
                      }),
                    },
                  ],
                },
              ]}
            />
          </View>
        ))}
      </View>
      <Pressable
        role="button"
        aria-label="Replay motion sample"
        onPress={play}
        {...ring.handlers}
        style={[styles.button, ring.style]}
      >
        <BodyText variant="label" color={colors.white}>
          Replay
        </BodyText>
      </Pressable>
      {reduced === true ? (
        <BodyText variant="bodySm" muted>
          Reduced motion is on, so bars appear without animation.
        </BodyText>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bars: { gap: spacing.sm, marginBottom: spacing.lg },
  track: { height: 14, overflow: "hidden" },
  bar: { height: 14 },
  button: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    alignSelf: "flex-start",
    justifyContent: "center",
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.ink,
    marginBottom: spacing.sm,
  },
});

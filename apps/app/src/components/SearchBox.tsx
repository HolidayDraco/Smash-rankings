import { useRef } from "react";
import { Pressable, StyleSheet, TextInput, View } from "react-native";
import { SEARCH_MAX_QUERY_LENGTH } from "@sr/core";
import {
  BodyText,
  colors,
  fontFamilies,
  minTouchTarget,
  spacing,
  typeScale,
  useFocusRing,
} from "@sr/ui";

export function SearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}) {
  const input = useFocusRing();
  const clear = useFocusRing();
  const inputRef = useRef<TextInput>(null);
  return (
    <View style={styles.wrap}>
      <TextInput
        ref={inputRef}
        maxLength={SEARCH_MAX_QUERY_LENGTH}
        aria-label="Search players"
        role="searchbox"
        placeholder="Search players"
        placeholderTextColor={colors.inkMuted}
        value={value}
        onChangeText={onChange}
        onKeyPress={(event) => {
          if (event.nativeEvent.key === "Escape") onChange("");
        }}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        {...input.handlers}
        style={[styles.input, input.style]}
      />
      {value ? (
        <Pressable
          role="button"
          aria-label="Clear search"
          onPress={() => {
            onChange("");
            inputRef.current?.focus();
          }}
          {...clear.handlers}
          style={[styles.clear, clear.style]}
        >
          <BodyText variant="label">Clear</BodyText>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", gap: spacing.sm, alignItems: "center" },
  input: {
    flex: 1,
    minHeight: minTouchTarget,
    paddingHorizontal: spacing.md,
    borderWidth: 2,
    borderColor: colors.ink,
    backgroundColor: colors.white,
    color: colors.ink,
    fontFamily: fontFamilies.body,
    fontSize: typeScale.body.fontSize,
  },
  clear: {
    minHeight: minTouchTarget,
    minWidth: minTouchTarget,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surface,
  },
});

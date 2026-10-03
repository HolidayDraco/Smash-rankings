import { Fragment } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";
import { BodyText, DisplayText, colors, fontFamilies, spacing } from "@sr/ui";
import { parseMarkdown, type Inline } from "../lib/markdown";

function Inlines({ parts }: { parts: Inline[] }) {
  return (
    <>
      {parts.map((part, index) => {
        if (part.kind === "bold")
          return (
            <Text key={index} style={styles.bold}>
              {part.text}
            </Text>
          );
        if (part.kind === "italic")
          return (
            <Text key={index} style={styles.italic}>
              {part.text}
            </Text>
          );
        if (part.kind === "link") {
          const web =
            Platform.OS === "web"
              ? ({
                  href: part.href,
                  hrefAttrs: { target: "_blank", rel: "noopener noreferrer" },
                } as object)
              : {};
          return (
            <Text
              key={index}
              role="link"
              style={styles.link}
              onPress={() => void Linking.openURL(part.href)}
              {...web}
            >
              {part.text}
            </Text>
          );
        }
        return <Fragment key={index}>{part.text}</Fragment>;
      })}
    </>
  );
}

/** Renders the safe markdown subset with our own type styles. No HTML, so it works on native too. */
export function Markdown({ source }: { source: string }) {
  return (
    <>
      {parseMarkdown(source).map((block, index) => {
        if (block.kind === "heading")
          return (
            <DisplayText key={index} variant="h2" style={styles.heading}>
              {block.text}
            </DisplayText>
          );
        if (block.kind === "list")
          return (
            <View key={index} role="list" style={styles.list}>
              {block.items.map((item, i) => (
                <View key={i} role="listitem" style={styles.item}>
                  <View aria-hidden style={styles.bullet} />
                  <BodyText style={styles.flex}>
                    <Inlines parts={item} />
                  </BodyText>
                </View>
              ))}
            </View>
          );
        return (
          <BodyText key={index} style={styles.paragraph}>
            <Inlines parts={block.inline} />
          </BodyText>
        );
      })}
    </>
  );
}

const styles = StyleSheet.create({
  heading: { marginTop: spacing.xl, marginBottom: spacing.sm },
  paragraph: { marginBottom: spacing.md },
  list: { gap: spacing.sm, marginBottom: spacing.md },
  item: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  bullet: {
    width: 8,
    height: 14,
    marginTop: 5,
    backgroundColor: colors.accent,
    transform: [{ skewX: "-12deg" }],
  },
  flex: { flex: 1 },
  bold: { fontFamily: fontFamilies.bodyBold },
  italic: { fontStyle: "italic" },
  link: { color: colors.accent, textDecorationLine: "underline" },
});

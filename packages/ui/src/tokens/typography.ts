/** Font family names registered by the app with expo-font (@expo-google-fonts, SIL OFL). */
export const fontFamilies = {
  displayBlack: "BarlowCondensed_900Black_Italic",
  displayExtraBold: "BarlowCondensed_800ExtraBold_Italic",
  condensedBold: "BarlowCondensed_700Bold",
  body: "Barlow_400Regular",
  bodyMedium: "Barlow_500Medium",
  bodySemiBold: "Barlow_600SemiBold",
  bodyBold: "Barlow_700Bold",
} as const;

export interface TextStyleToken {
  fontFamily: string;
  fontSize: number;
  lineHeight: number;
  letterSpacing?: number;
  textTransform?: "uppercase";
}

export const typeScale = {
  display: {
    fontFamily: fontFamilies.displayBlack,
    fontSize: 64,
    lineHeight: 62,
    textTransform: "uppercase",
  },
  h1: {
    fontFamily: fontFamilies.displayBlack,
    fontSize: 44,
    lineHeight: 44,
    textTransform: "uppercase",
  },
  h2: {
    fontFamily: fontFamilies.displayExtraBold,
    fontSize: 32,
    lineHeight: 34,
    textTransform: "uppercase",
  },
  h3: {
    fontFamily: fontFamilies.displayExtraBold,
    fontSize: 24,
    lineHeight: 28,
    textTransform: "uppercase",
  },
  body: { fontFamily: fontFamilies.body, fontSize: 16, lineHeight: 24 },
  bodySm: { fontFamily: fontFamilies.body, fontSize: 14, lineHeight: 20 },
  label: {
    fontFamily: fontFamilies.bodySemiBold,
    fontSize: 12,
    lineHeight: 16,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  stat: { fontFamily: fontFamilies.bodyBold, fontSize: 16, lineHeight: 20 },
} as const satisfies Record<string, TextStyleToken>;

export type TypeVariant = keyof typeof typeScale;

/** Light theme only. Every text-capable color is checked in contrast.test.ts. */
export const colors = {
  white: "#FFFFFF",
  surface: "#F2F4F8",
  line: "#D3D9E4",
  ink: "#0A0F1F",
  inkMuted: "#475066",
  /** Primary accent: electric blue. */
  accent: "#1530E8",
  /** Secondary accent: hot red, for emphasis and "down" states. */
  hot: "#C8102E",
  /** Fill-only highlight. Never use as text on white. Pair with ink text. */
  signal: "#FFD60A",
  positive: "#0B7A3E",
  negative: "#C8102E",
} as const;

export type ColorToken = keyof typeof colors;

export interface ContrastPair {
  name: string;
  foreground: ColorToken;
  background: ColorToken;
}

/** Text and background combinations that are approved for use (min 4.5:1). */
export const textPairs: readonly ContrastPair[] = [
  { name: "Body text on white", foreground: "ink", background: "white" },
  { name: "Muted text on white", foreground: "inkMuted", background: "white" },
  { name: "Accent text on white", foreground: "accent", background: "white" },
  { name: "Hot text on white", foreground: "hot", background: "white" },
  { name: "Positive text on white", foreground: "positive", background: "white" },
  { name: "Negative text on white", foreground: "negative", background: "white" },
  { name: "Body text on surface", foreground: "ink", background: "surface" },
  { name: "Muted text on surface", foreground: "inkMuted", background: "surface" },
  { name: "Accent text on surface", foreground: "accent", background: "surface" },
  { name: "Positive text on surface", foreground: "positive", background: "surface" },
  { name: "Negative text on surface", foreground: "negative", background: "surface" },
  { name: "White text on accent", foreground: "white", background: "accent" },
  { name: "White text on hot", foreground: "white", background: "hot" },
  { name: "White text on ink", foreground: "white", background: "ink" },
  { name: "Ink text on signal", foreground: "ink", background: "signal" },
];

function channel(value: number): number {
  const s = value / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m?.[1]) throw new Error(`Expected #RRGGBB, got ${hex}`);
  const n = parseInt(m[1], 16);
  return (
    0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255)
  );
}

/** WCAG 2.x contrast ratio between two #RRGGBB colors. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

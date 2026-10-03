/** Durations in ms. Snappy: nothing in the UI takes longer than `slow`. */
export const durations = { instant: 0, fast: 120, base: 180, slow: 280 } as const;

/** Cubic-bezier control points (fast out, quick settle). */
export const easing = { out: [0.2, 0.9, 0.2, 1], inOut: [0.6, 0, 0.2, 1] } as const;

export const staggerMs = 45;

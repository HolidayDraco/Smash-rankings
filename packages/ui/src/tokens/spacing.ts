/** 4-point spacing scale. */
export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  huge: 48,
} as const;

export const radii = { sm: 2, md: 4 } as const;

/** Minimum touch target (px) on every platform. */
export const minTouchTarget = 44;

/** Angle of every diagonal cut, in degrees. One angle keeps the system coherent. */
export const cutAngleDeg = 12;

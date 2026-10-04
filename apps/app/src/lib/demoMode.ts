/**
 * Demo mode answers every query from bundled sample data instead of the API. It is on when no API
 * URL is configured, or when EXPO_PUBLIC_DEMO is "1" (even with a URL, to demo against a live API).
 */
export function decideDemoMode(env: {
  apiUrl: string | undefined;
  demoFlag: string | undefined;
}): boolean {
  return !env.apiUrl || env.demoFlag === "1";
}

/** Both reads must stay literal `process.env.EXPO_PUBLIC_...` expressions: Expo inlines them at build time. */
export const isDemoMode = (): boolean =>
  decideDemoMode({
    apiUrl: process.env.EXPO_PUBLIC_API_URL,
    demoFlag: process.env.EXPO_PUBLIC_DEMO,
  });

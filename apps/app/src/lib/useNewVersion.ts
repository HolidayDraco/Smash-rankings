import { useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { embeddedBuildId, isNewVersion, parseBuildId, shouldCheckVersion } from "./buildVersion";

/**
 * Web only. Asks /build-id.json which build is live when the page becomes visible again (at most
 * once per 5 minutes). Returns true once it differs from the build running here. Failures are
 * silent, and with no embedded build id (dev) nothing is ever fetched.
 */
export function useNewVersion(): boolean {
  const [available, setAvailable] = useState(false);
  const lastChecked = useRef<number | null>(null);
  useEffect(() => {
    const embedded = embeddedBuildId();
    if (Platform.OS !== "web" || !embedded || typeof document === "undefined") return;
    const check = async () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (!shouldCheckVersion(lastChecked.current, now)) return;
      lastChecked.current = now;
      try {
        const response = await fetch("/build-id.json", { cache: "no-store" });
        if (!response.ok) return;
        if (isNewVersion(embedded, parseBuildId(await response.json()))) setAvailable(true);
      } catch {
        // Offline or blocked: say nothing.
      }
    };
    void check();
    document.addEventListener("visibilitychange", check);
    return () => document.removeEventListener("visibilitychange", check);
  }, []);
  return available;
}

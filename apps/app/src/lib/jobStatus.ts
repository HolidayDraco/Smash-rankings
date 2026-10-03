import type { IngestJob, JobStatus } from "@sr/core";

export type JobState = "ok" | "late" | "failed" | "never" | "running";

export const JOB_LABELS: Record<IngestJob, string> = {
  discover: "Find new events",
  sync: "Pull results",
  backfill: "Catch up history",
  rate: "Update rankings",
};

const HOUR_MS = 3_600_000;
/**
 * Sync and rate run every 2 hours (hourly Fri-Mon), and GitHub can start a run late, so 4 h means
 * something is stuck. Daily jobs get 26 h. Keep LATE_AFTER_HOURS in e2e/tests/info.spec.ts in step.
 */
export const LATE_AFTER_MS: Record<IngestJob, number> = {
  discover: 26 * HOUR_MS,
  sync: 4 * HOUR_MS,
  backfill: 26 * HOUR_MS,
  rate: 4 * HOUR_MS,
};

export function jobState(status: JobStatus, now: number = Date.now()): JobState {
  if (status.lastRunAt === null) return "never";
  const withinWindow = now - Date.parse(status.lastRunAt) < LATE_AFTER_MS[status.job];
  // A run with no finish time past its window was killed (time limit, lost runner): it failed.
  if (status.lastFinishedAt === null) return withinWindow ? "running" : "failed";
  if (status.ok === false) return "failed";
  return withinWindow ? "ok" : "late";
}

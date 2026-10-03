import type { IngestJob, JobStatus } from "@sr/core";

export type JobState = "ok" | "late" | "failed" | "never" | "running";

export const JOB_LABELS: Record<IngestJob, string> = {
  discover: "Find new events",
  sync: "Pull results",
  backfill: "Catch up history",
  rate: "Update rankings",
};

const HOUR_MS = 3_600_000;
/** Frequent jobs run about hourly, so 3 h means something is stuck. Daily jobs get 26 h. */
export const LATE_AFTER_MS: Record<IngestJob, number> = {
  discover: 26 * HOUR_MS,
  sync: 3 * HOUR_MS,
  backfill: 26 * HOUR_MS,
  rate: 3 * HOUR_MS,
};

export function jobState(status: JobStatus, now: number = Date.now()): JobState {
  if (status.lastRunAt === null) return "never";
  if (status.lastFinishedAt === null) return "running";
  if (status.ok === false) return "failed";
  return now - Date.parse(status.lastRunAt) < LATE_AFTER_MS[status.job] ? "ok" : "late";
}

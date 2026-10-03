import { describe, expect, it } from "vitest";
import type { JobStatus } from "@sr/core";
import { jobState } from "./jobStatus";

const now = Date.parse("2026-10-03T12:00:00Z");
const ago = (hours: number) => new Date(now - hours * 3_600_000).toISOString();
const run = (job: JobStatus["job"], hours: number, ok: boolean | null = true): JobStatus => ({
  job,
  lastRunAt: ago(hours),
  lastFinishedAt: ago(hours),
  ok,
});

describe("jobState", () => {
  it("is ok inside the window and late outside it, per job", () => {
    expect(jobState(run("sync", 2.9), now)).toBe("ok");
    expect(jobState(run("rate", 3.1), now)).toBe("late");
    expect(jobState(run("discover", 25), now)).toBe("ok");
    expect(jobState(run("backfill", 27), now)).toBe("late");
  });
  it("shows failures even when recent", () => {
    expect(jobState(run("sync", 1, false), now)).toBe("failed");
  });
  it("handles never-run and still-running jobs", () => {
    expect(jobState({ job: "rate", lastRunAt: null, lastFinishedAt: null, ok: null }, now)).toBe(
      "never",
    );
    expect(jobState({ ...run("rate", 0.1), lastFinishedAt: null, ok: null }, now)).toBe("running");
  });
});

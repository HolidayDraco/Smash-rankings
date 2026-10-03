import { z } from "zod";
import { ATTRIBUTION } from "./constants";

/** Every API body carries the start.gg attribution (API ToS). */
const attributionField = z.literal(ATTRIBUTION);

/** ISO-8601 timestamp string, or null when unknown. */
const isoTimestamp = z.iso.datetime({ offset: true });

export const INGEST_JOBS = ["discover", "sync", "backfill", "rate"] as const;
export type IngestJob = (typeof INGEST_JOBS)[number];

/** `GET /v1/meta`: when the rankings were last rebuilt. */
export const metaResponseSchema = z.strictObject({
  dataVersion: z.number().int().nonnegative().nullable(),
  lastRatedAt: isoTimestamp.nullable(),
  attribution: attributionField,
});
export type MetaResponse = z.infer<typeof metaResponseSchema>;

/**
 * `GET /v1/status`: latest run per job. Public on purpose, so it carries only
 * times and ok/failed: never error text, request counts, or other internals.
 * `ok` is null while a run is still going or when a job has never run.
 */
export const jobStatusSchema = z.strictObject({
  job: z.enum(INGEST_JOBS),
  lastRunAt: isoTimestamp.nullable(),
  lastFinishedAt: isoTimestamp.nullable(),
  ok: z.boolean().nullable(),
});
export type JobStatus = z.infer<typeof jobStatusSchema>;

export const statusResponseSchema = z.strictObject({
  jobs: z.array(jobStatusSchema).length(INGEST_JOBS.length),
  attribution: attributionField,
});
export type StatusResponse = z.infer<typeof statusResponseSchema>;

/** Body of every 404 and 500. Deliberately generic: no stack traces or internals. */
export const errorResponseSchema = z.strictObject({
  error: z.string(),
  attribution: attributionField,
});
export type ErrorResponse = z.infer<typeof errorResponseSchema>;

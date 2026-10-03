import { readFileSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createDb, events, ingestRuns, tournaments, type Database } from "@sr/db";
import { runMigrations } from "@sr/db/migrate";
import { discover } from "./discover";
import { createDeadline, parseJobArgs, redactError, runJob, UsageError } from "./harness";

const TOKEN = "SECRET-TOKEN-abc123";
const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../packages/startgg/fixtures/${name}.json`, import.meta.url), "utf8"),
  );

/** Fake start.gg: replies with the queued bodies in order; counts calls. */
function fakeClientOptions(replies: { status?: number; body: unknown }[]) {
  const queue = [...replies];
  let now = 1_000_000;
  return {
    fetch: async () => {
      const reply = queue.shift();
      if (!reply) throw new Error("fake fetch: no reply queued");
      return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
    },
    clock: () => now,
    sleep: async (ms: number) => void (now += ms),
    logger: () => {},
  };
}

const twoPages = () => [
  { body: fixture("tournaments-page-1") },
  { body: fixture("tournaments-page-2") },
];
const run = (
  argv: string[],
  replies: { status?: number; body: unknown }[],
  env: Record<string, string | undefined>,
  out: string[] = [],
) =>
  runJob("discover", argv, discover, {
    env,
    clientOptions: fakeClientOptions(replies),
    out: (line) => out.push(line),
  });

describe("argument parsing and helpers", () => {
  it("parses flags and ignores a leading --", () => {
    const args = parseJobArgs(["--", "--dry-run", "--from", "2026-01-01", "--to", "2026-02-01"]);
    expect(args.dryRun).toBe(true);
    expect(args.from).toEqual(new Date("2026-01-01"));
    expect(args.timeBudgetMinutes).toBe(20);
  });
  it("rejects bad dates and reversed windows", () => {
    expect(() => parseJobArgs(["--from", "nope"])).toThrow(UsageError);
    expect(() => parseJobArgs(["--from", "2026-02-01", "--to", "2026-01-01"])).toThrow(UsageError);
  });
  it("redacts the token and URLs from errors", () => {
    const text = redactError(new Error(`bad ${TOKEN} at postgres://u:p@host/db`), [TOKEN]);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("u:p@host");
  });
  it("expires the deadline before the budget runs out", () => {
    let now = 0;
    const deadline = createDeadline(10, () => now);
    expect(deadline.expired()).toBe(false);
    now = 9.5 * 60_000;
    expect(deadline.expired()).toBe(true);
  });
  it("dry run needs only the token and prints a summary", async () => {
    const out: string[] = [];
    const code = await run(["--dry-run"], twoPages(), { STARTGG_TOKEN: TOKEN }, out);
    expect(code).toBe(0);
    expect(out).toEqual([
      "[dry run] discover: 4 events found, 2 qualify, 0 online stored, 2 skipped; 2 requests",
    ]);
  });
  it("exits with a usage error when the token is missing", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
    expect(await run(["--dry-run"], [], {})).toBe(2);
    stderr.mockRestore();
  });
});

// CI must always run the database tests; a silent skip would hide a broken setup.
if (process.env.CI && !testDatabaseUrl) throw new Error("TEST_DATABASE_URL must be set in CI");

describe.skipIf(!testDatabaseUrl)(
  "discover job (skipped: TEST_DATABASE_URL is not set; CI always sets it)",
  () => {
    let db: Database;
    let close: () => Promise<void>;
    const env = { STARTGG_TOKEN: TOKEN, DATABASE_URL: testDatabaseUrl };
    const eventRows = () => db.select().from(events).orderBy(events.id);

    beforeAll(async () => {
      if (!testDatabaseUrl) return;
      if (/neon\.tech/i.test(testDatabaseUrl)) throw new Error("Use a disposable database.");
      ({ db, close } = createDb(testDatabaseUrl, { maxConnections: 1 }));
      await db.execute(sql`drop schema if exists drizzle cascade`);
      await db.execute(sql`drop schema if exists public cascade`);
      await db.execute(sql`create schema public`);
      await runMigrations(db);
    }, 30_000);
    beforeEach(async () => {
      await db.delete(events);
      await db.delete(tournaments);
      await db.delete(ingestRuns);
    });
    afterAll(async () => {
      await close?.();
    });

    it("skips a 15-entrant event and an out-of-state one, keeps 16, and stores the online event as non-qualifying", async () => {
      expect(await run([], [{ body: fixture("tournaments-edge") }], env)).toBe(0);
      const rows = await eventRows();
      expect(rows.map((r) => [r.id, r.qualifies, r.isOnline, r.syncStatus])).toEqual([
        [9101, true, false, "pending"],
        [9103, false, true, "pending"],
      ]);
      expect((await db.select().from(tournaments)).map((t) => t.id)).toEqual([5101, 5102]);
    });

    it("stops a stored event qualifying when its tournament is out of the launch region", async () => {
      await run([], [{ body: fixture("tournaments-edge") }], env);
      const moved = edge();
      (moved.data.tournaments.nodes[0] ?? {})["addrState"] = "CA";
      expect(await run([], [{ body: moved }], env)).toBe(0);
      const rows = await eventRows();
      expect(rows.map((r) => [r.id, r.qualifies])).toEqual([
        [9101, false],
        [9103, false],
      ]);
    });

    it("skips doubles and small events", async () => {
      expect(await run([], twoPages(), env)).toBe(0);
      expect((await eventRows()).map((r) => r.id)).toEqual([9001, 9003]);
      expect((await db.select().from(tournaments)).map((t) => t.id)).toEqual([5001, 5002]);
    });

    it("is idempotent and never resets sync progress", async () => {
      await run([], twoPages(), env);
      await db
        .update(events)
        .set({ syncStatus: "partial", syncCursor: '{"page":3,"perPage":40}' })
        .where(eq(events.id, 9001));
      await run([], twoPages(), env);
      const rows = await eventRows();
      expect(rows).toHaveLength(2);
      expect(rows[0]).toMatchObject({
        id: 9001,
        syncStatus: "partial",
        syncCursor: '{"page":3,"perPage":40}',
      });
      expect(rows[1]).toMatchObject({ id: 9003, syncStatus: "pending", syncCursor: null });
      expect(await db.select().from(tournaments)).toHaveLength(2);
    });

    it("dry run writes nothing, not even an ingest_runs row", async () => {
      const code = await run(["--dry-run"], twoPages(), { ...env });
      expect(code).toBe(0);
      expect(await eventRows()).toHaveLength(0);
      expect(await db.select().from(tournaments)).toHaveLength(0);
      expect(await db.select().from(ingestRuns)).toHaveLength(0);
    });

    it("writes exactly one ingest_runs row with the request count", async () => {
      await run([], twoPages(), env);
      const runs = await db.select().from(ingestRuns);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        job: "discover",
        status: "success",
        requestsUsed: 2,
        eventsTouched: 2,
        error: null,
      });
      expect(runs[0]?.finishedAt).toBeInstanceOf(Date);
    });

    const edge = () =>
      structuredClone(fixture("tournaments-edge")) as {
        data: { tournaments: { nodes: Record<string, unknown>[] } };
      };
    const firstEvent = (data: ReturnType<typeof edge>) =>
      (data.data.tournaments.nodes[0]?.["events"] as Record<string, unknown>[])[0] ?? {};

    it("stops a stored event qualifying when it is later classified skip, without inserting skipped ones", async () => {
      await run([], [{ body: fixture("tournaments-edge") }], env);
      const shrunk = edge();
      firstEvent(shrunk)["numEntrants"] = 15;
      expect(await run([], [{ body: shrunk }], env)).toBe(0);
      const rows = await eventRows();
      expect(rows.map((r) => [r.id, r.qualifies, r.numEntrants])).toEqual([
        [9101, false, 15],
        [9103, false, 128],
      ]);
    });

    it("renames a stale slug holder when a recreated tournament and event reuse a slug", async () => {
      await run([], [{ body: fixture("tournaments-edge") }], env);
      const recreated = edge();
      const tournament = recreated.data.tournaments.nodes[0] ?? {};
      tournament["id"] = 5999;
      firstEvent(recreated)["id"] = 9999;
      for (let i = 0; i < 2; i++) {
        expect(await run([], [{ body: recreated }], env)).toBe(0); // second run is a no-op
      }
      const rows = await eventRows();
      expect(rows.map((r) => [r.id, r.slug])).toEqual([
        [9101, "tournament/fake-edge/event/exactly-16~stale-9101"],
        [9103, "tournament/fake-online/event/online-singles"],
        [9999, "tournament/fake-edge/event/exactly-16"],
      ]);
      const slugs = (await db.select().from(tournaments)).map((t) => [t.id, t.slug]);
      expect(slugs).toContainEqual([5101, "tournament/fake-5101~stale-5101"]);
      expect(slugs).toContainEqual([5999, "tournament/fake-5101"]);
      const runs = await db.select().from(ingestRuns);
      expect(runs.every((r) => r.status === "success")).toBe(true);
    });

    it("treats an event with both online flags unknown as in person", async () => {
      const unknown = edge();
      firstEvent(unknown)["isOnline"] = null;
      (unknown.data.tournaments.nodes[0] ?? {})["isOnline"] = null;
      await run([], [{ body: unknown }], env);
      const row = (await eventRows()).find((r) => r.id === 9101);
      expect(row).toMatchObject({ qualifies: true, isOnline: false });
    });

    it("records an auth failure as an error, exits non-zero, and leaks no token", async () => {
      const stderr = vi.spyOn(process.stderr, "write").mockReturnValue(true);
      const code = await run([], [{ status: 401, body: { message: `bad ${TOKEN}` } }], env);
      const printed = stderr.mock.calls.map((c) => String(c[0])).join("");
      stderr.mockRestore();
      expect(code).toBe(1);
      const runs = await db.select().from(ingestRuns);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.status).toBe("error");
      expect(runs[0]?.requestsUsed).toBe(1);
      expect(runs[0]?.error).toMatch(/token/i);
      expect(`${runs[0]?.error}${printed}`).not.toContain(TOKEN);
      expect(await eventRows()).toHaveLength(0);
    });
  },
);

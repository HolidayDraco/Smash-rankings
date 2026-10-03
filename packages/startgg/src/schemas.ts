import { z } from "zod";
import type {
  EventSetsPageQuery,
  EventStandingsPageQuery,
  TournamentsPageQuery,
} from "./generated/graphql";

// Zod validates what start.gg actually sends us. The `Assert` lines at the
// bottom make the compiler fail if these schemas drift from the generated
// (codegen) types, so the two can never silently disagree.

const id = z.number().int();
const nullableInt = z.number().int().nullable();
const nullableString = z.string().nullable();

const pageInfo = z.object({ total: nullableInt, totalPages: nullableInt }).nullable();
const connection = <T extends z.ZodType>(node: T) =>
  z.object({ pageInfo, nodes: z.array(node.nullable()) });

const player = z.object({
  id,
  gamerTag: nullableString,
  prefix: nullableString,
  user: z.object({ slug: nullableString }).nullable(),
});
const entrant = z.object({
  id,
  participants: z.array(z.object({ player: player.nullable() }).nullable()).nullable(),
});
const setNode = z.object({
  id,
  completedAt: nullableInt,
  winnerId: nullableInt,
  displayScore: nullableString,
  fullRoundText: nullableString,
  slots: z
    .array(
      z
        .object({
          entrant: entrant.nullable(),
          standing: z
            .object({
              stats: z
                .object({ score: z.object({ value: z.number().nullable() }).nullable() })
                .nullable(),
            })
            .nullable(),
        })
        .nullable(),
    )
    .nullable(),
});

const eventNode = z.object({
  id,
  name: nullableString,
  slug: nullableString,
  numEntrants: nullableInt,
  isOnline: z.boolean().nullable(),
  state: z
    .enum(["CREATED", "ACTIVE", "COMPLETED", "READY", "INVALID", "CALLED", "QUEUED"])
    .nullable(),
  startAt: nullableInt,
  type: nullableInt,
  teamRosterSize: z.object({ minPlayers: nullableInt, maxPlayers: nullableInt }).nullable(),
  videogame: z.object({ id: nullableInt }).nullable(),
});

const tournamentNode = z.object({
  id,
  name: nullableString,
  slug: nullableString,
  countryCode: nullableString,
  addrState: nullableString,
  city: nullableString,
  isOnline: z.boolean().nullable(),
  numAttendees: nullableInt,
  startAt: nullableInt,
  endAt: nullableInt,
  events: z.array(eventNode.nullable()).nullable(),
});

export const tournamentsDataSchema = z.object({
  tournaments: connection(tournamentNode).nullable(),
});
export const setsDataSchema = z.object({
  event: z.object({ id, sets: connection(setNode).nullable() }).nullable(),
});
export const standingsDataSchema = z.object({
  event: z
    .object({
      id,
      standings: connection(
        z.object({
          placement: nullableInt,
          entrant: z
            .object({
              id,
              participants: z
                .array(z.object({ player: z.object({ id }).nullable() }).nullable())
                .nullable(),
            })
            .nullable(),
        }),
      ).nullable(),
    })
    .nullable(),
});

type Extends<A, B> = [A] extends [B] ? true : false;
type Assert<_T extends true> = never;
export type SchemaMatchesCodegen = [
  Assert<Extends<z.infer<typeof tournamentsDataSchema>, TournamentsPageQuery>>,
  Assert<Extends<z.infer<typeof setsDataSchema>, EventSetsPageQuery>>,
  Assert<Extends<z.infer<typeof standingsDataSchema>, EventStandingsPageQuery>>,
];

export type TournamentNode = z.infer<typeof tournamentNode>;
export type EventNode = z.infer<typeof eventNode>;
export type SetNode = z.infer<typeof setNode>;
export type StandingNode = NonNullable<
  NonNullable<
    NonNullable<z.infer<typeof standingsDataSchema>["event"]>["standings"]
  >["nodes"][number]
>;

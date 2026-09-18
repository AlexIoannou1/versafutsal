import { and, eq, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  ownerSubscriptionsTable,
  venuesTable,
} from "@workspace/db/schema";
import { resolveEffectivePlan } from "./entitlements";

export const LEADERBOARD_MINIMUM_MATCHES = 3;

export type LeaderboardMetric = "goals" | "matches" | "winRate";

type PlayerTotals = {
  playerId: string;
  name: string;
  goals: number;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  winRateEligible: boolean;
};

type Venue = { id: string; name: string };

const aggregateSql = (venueId: string) => sql`
  SELECT
    mp.player_id AS "playerId",
    u.name,
    COALESCE(SUM(mse.goals), 0)::int AS goals,
    COUNT(*)::int AS matches,
    COUNT(*) FILTER (
      WHERE (mp.team = 'HOME' AND mr.home_score > mr.away_score)
         OR (mp.team = 'AWAY' AND mr.away_score > mr.home_score)
    )::int AS wins,
    COUNT(*) FILTER (WHERE mr.home_score = mr.away_score)::int AS draws,
    COUNT(*) FILTER (
      WHERE (mp.team = 'HOME' AND mr.home_score < mr.away_score)
         OR (mp.team = 'AWAY' AND mr.away_score < mr.home_score)
    )::int AS losses
  FROM match_participants mp
  INNER JOIN match_results mr ON mr.id = mp.match_id
  INNER JOIN match_stat_events mse
    ON mse.match_id = mp.match_id AND mse.participant_id = mp.id
  INNER JOIN users u
    ON u.id = mp.player_id AND u.role = 'PLAYER' AND u.deleted_at IS NULL
  WHERE mr.venue_id = ${venueId}
  GROUP BY mp.player_id, u.name
`;

function playerFromJson(value: unknown): PlayerTotals {
  const player = value as Record<string, unknown>;
  return {
    playerId: String(player.playerId),
    name: String(player.name),
    goals: Number(player.goals),
    matches: Number(player.matches),
    wins: Number(player.wins),
    draws: Number(player.draws),
    losses: Number(player.losses),
    winRate: Number(player.winRate),
    winRateEligible: Boolean(player.winRateEligible),
  };
}

async function eligibleVenue(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  venueId: string,
): Promise<Venue | null> {
  const [row] = await tx
    .select({ venue: venuesTable, subscription: ownerSubscriptionsTable })
    .from(venuesTable)
    .leftJoin(ownerSubscriptionsTable, eq(ownerSubscriptionsTable.ownerId, venuesTable.ownerId))
    .where(and(eq(venuesTable.id, venueId), eq(venuesTable.status, "APPROVED")))
    .limit(1);
  if (!row || resolveEffectivePlan(row.subscription) !== "ELITE") return null;
  return { id: row.venue.id, name: row.venue.name };
}

function ordering(metric: LeaderboardMetric) {
  if (metric === "goals") return sql`goals DESC, wins DESC, matches DESC, "playerId" ASC`;
  if (metric === "matches") return sql`matches DESC, wins DESC, goals DESC, "playerId" ASC`;
  return sql`wins::numeric / matches DESC, matches DESC, goals DESC, "playerId" ASC`;
}

export async function getLeaderboard(input: {
  venueId: string;
  metric: LeaderboardMetric;
  page: number;
  limit: number;
}) {
  return db.transaction(async (tx) => {
    const venue = await eligibleVenue(tx, input.venueId);
    if (!venue) return null;
    const minimum = input.metric === "winRate" ? LEADERBOARD_MINIMUM_MATCHES : 1;
    const offset = (input.page - 1) * input.limit;
    const result = await tx.execute(sql`
      WITH aggregate AS (${aggregateSql(input.venueId)}),
      eligible AS (
        SELECT * FROM aggregate WHERE matches >= ${minimum}
      ),
      ranked AS (
        SELECT *, ROW_NUMBER() OVER (ORDER BY ${ordering(input.metric)})::int AS rank
        FROM eligible
      ),
      page AS (
        SELECT * FROM ranked ORDER BY rank LIMIT ${input.limit} OFFSET ${offset}
      )
      SELECT
        (SELECT COUNT(*)::int FROM eligible) AS total,
        COALESCE(jsonb_agg(jsonb_build_object(
          'rank', page.rank,
          'playerId', page."playerId",
          'name', page.name,
          'goals', page.goals,
          'matches', page.matches,
          'wins', page.wins,
          'draws', page.draws,
          'losses', page.losses,
          'winRate', page.wins * 100.0 / page.matches,
          'winRateEligible', page.matches >= ${LEADERBOARD_MINIMUM_MATCHES}
        ) ORDER BY page.rank) FILTER (WHERE page."playerId" IS NOT NULL), '[]'::jsonb) AS entries
      FROM page
    `);
    const row = result.rows[0] as { total: number | string; entries: unknown[] };
    return {
      venueId: venue.id,
      venueName: venue.name,
      metric: input.metric,
      page: input.page,
      limit: input.limit,
      total: Number(row.total),
      minimumMatches: LEADERBOARD_MINIMUM_MATCHES as 3,
      entries: row.entries.map((entry) => ({
        rank: Number((entry as Record<string, unknown>).rank),
        ...playerFromJson(entry),
      })),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getLeaderboardPlayer(venueId: string, playerId: string) {
  return db.transaction(async (tx) => {
    const venue = await eligibleVenue(tx, venueId);
    if (!venue) return null;
    const result = await tx.execute(sql`
      WITH aggregate AS (${aggregateSql(venueId)})
      SELECT jsonb_build_object(
        'playerId', "playerId", 'name', name, 'goals', goals, 'matches', matches,
        'wins', wins, 'draws', draws, 'losses', losses,
        'winRate', wins * 100.0 / matches,
        'winRateEligible', matches >= ${LEADERBOARD_MINIMUM_MATCHES}
      ) AS player
      FROM aggregate WHERE "playerId" = ${playerId}
    `);
    const row = result.rows[0] as { player: unknown } | undefined;
    return row ? { venueId: venue.id, venueName: venue.name, player: playerFromJson(row.player) } : undefined;
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function getLeaderboardPlayerSources(input: {
  venueId: string;
  playerId: string;
  page: number;
  limit: number;
}) {
  return db.transaction(async (tx) => {
    const venue = await eligibleVenue(tx, input.venueId);
    if (!venue) return null;
    const offset = (input.page - 1) * input.limit;
    const totalsResult = await tx.execute(sql`
      WITH aggregate AS (${aggregateSql(input.venueId)})
      SELECT jsonb_build_object(
        'playerId', "playerId", 'name', name, 'goals', goals, 'matches', matches,
        'wins', wins, 'draws', draws, 'losses', losses,
        'winRate', wins * 100.0 / matches,
        'winRateEligible', matches >= ${LEADERBOARD_MINIMUM_MATCHES}
      ) AS player FROM aggregate WHERE "playerId" = ${input.playerId}
    `);
    const sourcesResult = await tx.execute(sql`
      WITH sources AS (
        SELECT mr.id AS "matchId", mr.booking_id AS "bookingId", b.end_at AS "playedAt",
          mse.goals, mp.team, mr.home_score AS "homeScore", mr.away_score AS "awayScore",
          mr.version
        FROM match_participants mp
        INNER JOIN match_results mr ON mr.id = mp.match_id
        INNER JOIN match_stat_events mse
          ON mse.match_id = mp.match_id AND mse.participant_id = mp.id
        INNER JOIN bookings b ON b.id = mr.booking_id
        INNER JOIN users u
          ON u.id = mp.player_id AND u.role = 'PLAYER' AND u.deleted_at IS NULL
        WHERE mr.venue_id = ${input.venueId} AND mp.player_id = ${input.playerId}
      )
      SELECT
        (SELECT COUNT(*)::int FROM sources) AS total,
        COALESCE(jsonb_agg(to_jsonb(page) ORDER BY page."playedAt" DESC, page."matchId")
          FILTER (WHERE page."matchId" IS NOT NULL), '[]'::jsonb) AS sources
      FROM (
        SELECT * FROM sources ORDER BY "playedAt" DESC, "matchId"
        LIMIT ${input.limit} OFFSET ${offset}
      ) page
    `);
    const playerRow = totalsResult.rows[0] as { player: unknown } | undefined;
    const sourceRow = sourcesResult.rows[0] as { total: number | string; sources: unknown[] };
    return {
      venueId: venue.id,
      venueName: venue.name,
      player: playerRow ? playerFromJson(playerRow.player) : null,
      page: input.page,
      limit: input.limit,
      total: Number(sourceRow.total),
      sources: sourceRow.sources,
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
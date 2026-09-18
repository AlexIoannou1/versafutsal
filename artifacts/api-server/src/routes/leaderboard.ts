import { Router, type IRouter } from "express";
import {
  GetAdminVenueLeaderboardPlayerSourcesParams,
  GetAdminVenueLeaderboardPlayerSourcesQueryParams,
  GetAdminVenueLeaderboardPlayerSourcesResponse,
  GetVenueLeaderboardParams,
  GetVenueLeaderboardPlayerParams,
  GetVenueLeaderboardPlayerResponse,
  GetVenueLeaderboardQueryParams,
  GetVenueLeaderboardResponse,
} from "@workspace/api-zod";
import { requireAuth, requireRole } from "../middlewares/auth";
import {
  getLeaderboard,
  getLeaderboardPlayer,
  getLeaderboardPlayerSources,
} from "../lib/leaderboard";

const router: IRouter = Router();

export function parseLeaderboardQuery(query: unknown) {
  const raw = query && typeof query === "object"
    ? query as Record<string, unknown>
    : {};
  const parsed = GetVenueLeaderboardQueryParams.safeParse({
    ...raw,
    metric: raw.metric === undefined ? "goals" : raw.metric,
  });
  if (!parsed.success ||
      !Number.isInteger(parsed.data.page) ||
      !Number.isInteger(parsed.data.limit)) {
    return null;
  }
  return parsed.data;
}

export function parseLeaderboardSourcesQuery(query: unknown) {
  const parsed = GetAdminVenueLeaderboardPlayerSourcesQueryParams.safeParse(query);
  if (!parsed.success ||
      !Number.isInteger(parsed.data.page) ||
      !Number.isInteger(parsed.data.limit)) {
    return null;
  }
  return parsed.data;
}

router.get("/venues/:venueId/leaderboard", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  try {
    const params = GetVenueLeaderboardParams.safeParse(req.params);
    const query = parseLeaderboardQuery(req.query);
    if (!params.success || !query) {
      res.status(400).json({ error: "Invalid leaderboard request" });
      return;
    }
    const result = await getLeaderboard({ venueId: params.data.venueId, ...query });
    if (!result) {
      res.status(404).json({ error: "Leaderboard not found" });
      return;
    }
    res.json(GetVenueLeaderboardResponse.parse(result));
  } catch (error) {
    req.log.error({ err: error }, "Venue leaderboard lookup failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/venues/:venueId/leaderboard/players/:playerId", async (req, res): Promise<void> => {
  res.set("Cache-Control", "no-store");
  try {
    const params = GetVenueLeaderboardPlayerParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid leaderboard player request" });
      return;
    }
    const result = await getLeaderboardPlayer(params.data.venueId, params.data.playerId);
    if (!result) {
      res.status(404).json({ error: "Leaderboard player not found" });
      return;
    }
    res.json(GetVenueLeaderboardPlayerResponse.parse(result));
  } catch (error) {
    req.log.error({ err: error }, "Venue leaderboard player lookup failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

router.get(
  "/admin/venues/:venueId/leaderboard/players/:playerId/sources",
  requireAuth,
  requireRole("ADMIN"),
  async (req, res): Promise<void> => {
    res.set("Cache-Control", "no-store");
    try {
      const params = GetAdminVenueLeaderboardPlayerSourcesParams.safeParse(req.params);
      const query = parseLeaderboardSourcesQuery(req.query);
      if (!params.success || !query) {
        res.status(400).json({ error: "Invalid leaderboard sources request" });
        return;
      }
      const result = await getLeaderboardPlayerSources({ ...params.data, ...query });
      if (!result) {
        res.status(404).json({ error: "Leaderboard not found" });
        return;
      }
      res.json(GetAdminVenueLeaderboardPlayerSourcesResponse.parse(result));
    } catch (error) {
      req.log.error({ err: error }, "Admin leaderboard sources lookup failed");
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

export default router;
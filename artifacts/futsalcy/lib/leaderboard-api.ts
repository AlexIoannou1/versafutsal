import { useGetVenueLeaderboard, useGetVenueLeaderboardPlayer } from "@workspace/api-client-react";
import type { VenueLeaderboard, VenueLeaderboardPlayerResponse, LeaderboardMetric, LeaderboardEntry } from "@workspace/api-client-react";

export type { LeaderboardMetric, LeaderboardEntry, VenueLeaderboard, VenueLeaderboardPlayerResponse };

export function useVenueLeaderboard(venueId: string, metric: LeaderboardMetric, page: number, limit: number = 20, enabled: boolean = true) {
  return useGetVenueLeaderboard(
    venueId,
    { metric, page, limit },
    {
      query: {
        queryKey: ["venueLeaderboard", venueId, "board", metric, page, limit],
        enabled: enabled && !!venueId,
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnWindowFocus: "always",
        refetchInterval: 30_000,
        retry: false,
      }
    }
  );
}

export function usePlayerVenueLeaderboard(venueId: string, playerId: string, enabled: boolean = true) {
  return useGetVenueLeaderboardPlayer(
    venueId,
    playerId,
    {
      query: {
        queryKey: ["venueLeaderboard", venueId, "player", playerId],
        enabled: enabled && !!venueId && !!playerId,
        staleTime: 0,
        refetchOnMount: "always",
        refetchOnWindowFocus: "always",
        refetchInterval: 30_000,
        retry: false,
      }
    }
  );
}

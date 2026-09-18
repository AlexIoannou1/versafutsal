import {
  useDeleteAdminMatchStatistics,
  useGetAdminMatchStatistics,
  useGetOwnerMatchStatistics,
  useGetOwnerSubscription,
  useGetPlayerCareerMatchStatistics,
  useGetPlayerVenueMatchStatistics,
  usePutAdminMatchStatistics,
  usePutOwnerMatchStatistics,
} from "@workspace/api-client-react";

export type MatchTeam = "HOME" | "AWAY";

export interface MatchPlayer {
  id: string;
  name: string;
  avatarUrl?: string | null;
}

export interface MatchParticipant {
  id?: string;
  playerId: string;
  playerName?: string;
  team: MatchTeam;
  goals: number;
  assists: number;
  saves: number;
  yellowCards: number;
  redCards: number;
  player?: MatchPlayer;
}

export interface MatchStats {
  id: string;
  bookingId: string;
  homeScore: number;
  awayScore: number;
  participants: MatchParticipant[];
  version: number;
  updatedAt?: string;
}

export interface MatchStatsInput {
  reason?: string;
  homeScore: number;
  awayScore: number;
  participants: MatchParticipant[];
  expectedVersion: number;
}

export interface MatchStatsDetail {
  match: MatchStats | null;
  availablePlayers: MatchPlayer[];
}

export interface PlayerStatsSummary {
  matchesPlayed: number;
  goals: number;
  assists: number;
  saves: number;
  yellowCards: number;
  redCards: number;
  venuesPlayed?: number;
}

export function useOwnerMatchStatsPlan() {
  return useGetOwnerSubscription({
    query: { queryKey: ["ownerMatchStatsPlan"] },
  });
}

export function useOwnerBookingMatchStats(bookingId: string) {
  return useGetOwnerMatchStatistics(bookingId, {
    query: { queryKey: ["ownerBookingMatchStats", bookingId] },
  });
}

export function useUpsertOwnerBookingMatchStats() {
  return usePutOwnerMatchStatistics();
}

export function usePlayerCareerMatchStats(playerId: string) {
  return useGetPlayerCareerMatchStatistics(playerId, {
    query: { queryKey: ["playerCareerMatchStats", playerId] },
  });
}

export function usePlayerVenueMatchStats(venueId: string, playerId: string) {
  return useGetPlayerVenueMatchStatistics(venueId, playerId, {
    query: { queryKey: ["playerVenueMatchStats", venueId, playerId] },
  });
}

export function useAdminBookingMatchStats(matchId: string) {
  return useGetAdminMatchStatistics(matchId, {
    query: { queryKey: ["adminBookingMatchStats", matchId] },
  });
}

export function useUpdateAdminBookingMatchStats() {
  return usePutAdminMatchStatistics();
}

export function useDeleteAdminBookingMatchStats() {
  return useDeleteAdminMatchStatistics();
}
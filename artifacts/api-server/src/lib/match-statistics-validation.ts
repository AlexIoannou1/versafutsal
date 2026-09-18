export type MatchStatisticsParticipantInput = {
  playerId: string;
  team: "HOME" | "AWAY";
  goals: number;
  assists: number;
  saves: number;
  yellowCards: number;
  redCards: number;
};

export type MatchStatisticsInput = {
  homeScore: number;
  awayScore: number;
  expectedVersion: number;
  participants: MatchStatisticsParticipantInput[];
};

export function validateMatchStatistics(
  input: MatchStatisticsInput,
  bookingPlayerId?: string,
): string | null {
  const playerIds = input.participants.map((participant) => participant.playerId);
  if (new Set(playerIds).size !== playerIds.length) {
    return "Each player may only participate once.";
  }
  if (!input.participants.some((participant) => participant.team === "HOME") ||
      !input.participants.some((participant) => participant.team === "AWAY")) {
    return "Both HOME and AWAY teams must have at least one participant.";
  }
  if (bookingPlayerId && !playerIds.includes(bookingPlayerId)) {
    return "The player who made the booking must be included as a participant.";
  }
  const homeGoals = input.participants
    .filter((participant) => participant.team === "HOME")
    .reduce((total, participant) => total + participant.goals, 0);
  const awayGoals = input.participants
    .filter((participant) => participant.team === "AWAY")
    .reduce((total, participant) => total + participant.goals, 0);
  if (homeGoals !== input.homeScore || awayGoals !== input.awayScore) {
    return "Team scores must equal the goals attributed to their participants.";
  }
  return null;
}

export function isCompletedConfirmedBooking(
  booking: { status: string; endAt: Date },
  now = new Date(),
): boolean {
  return booking.status === "CONFIRMED" && booking.endAt <= now;
}

export function hasMatchVersionConflict(
  currentVersion: number | null,
  expectedVersion: number,
): boolean {
  return currentVersion === null
    ? expectedVersion !== 0
    : currentVersion !== expectedVersion;
}

export function ownerCanManageBooking(
  booking: { ownerId: string; status: string; endAt: Date },
  actorId: string,
  now = new Date(),
): boolean {
  return booking.ownerId === actorId && isCompletedConfirmedBooking(booking, now);
}
import assert from "node:assert/strict";
import {
  hasMatchVersionConflict,
  ownerCanManageBooking,
  validateMatchStatistics,
  type MatchStatisticsInput,
} from "./lib/match-statistics-validation";

const valid: MatchStatisticsInput = {
  homeScore: 2,
  awayScore: 1,
  expectedVersion: 0,
  participants: [
    { playerId: "a", team: "HOME", goals: 2, assists: 1, saves: 0, yellowCards: 0, redCards: 0 },
    { playerId: "b", team: "AWAY", goals: 1, assists: 0, saves: 4, yellowCards: 1, redCards: 0 },
  ],
};

assert.equal(validateMatchStatistics(valid, "a"), null);
assert.match(validateMatchStatistics({ ...valid, awayScore: 2 })!, /scores/i);
assert.match(validateMatchStatistics({
  ...valid,
  participants: [valid.participants[0]!, { ...valid.participants[1]!, playerId: "a" }],
})!, /only participate once/i);
assert.match(validateMatchStatistics({
  ...valid,
  participants: valid.participants.map((participant) => ({ ...participant, team: "HOME" as const })),
})!, /both HOME and AWAY/i);
assert.match(validateMatchStatistics(valid, "missing")!, /made the booking/i);
assert.equal(hasMatchVersionConflict(null, 0), false);
assert.equal(hasMatchVersionConflict(null, 1), true);
assert.equal(hasMatchVersionConflict(3, 3), false);
assert.equal(hasMatchVersionConflict(3, 2), true, "stale writes are rejected");

const completedBooking = {
  ownerId: "owner",
  status: "CONFIRMED",
  endAt: new Date("2026-01-01T10:00:00Z"),
};
const now = new Date("2026-01-01T11:00:00Z");
assert.equal(ownerCanManageBooking(completedBooking, "owner", now), true);
assert.equal(ownerCanManageBooking(completedBooking, "other-owner", now), false);
assert.equal(ownerCanManageBooking({ ...completedBooking, status: "CANCELLED" }, "owner", now), false);
assert.equal(ownerCanManageBooking({
  ...completedBooking,
  endAt: new Date("2026-01-01T12:00:00Z"),
}, "owner", now), false);

console.info("match statistics validation tests passed");
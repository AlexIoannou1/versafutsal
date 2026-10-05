import assert from "node:assert/strict";
import { bracketSize, canConfirmTournamentPayment, firstRoundSeeds } from "./lib/tournament-domain";

for (const entrants of [3, 5, 6, 7]) {
  const seeds = firstRoundSeeds(Array.from({ length: entrants }, (_, i) => i));
  assert.equal(seeds.length, bracketSize(entrants) / 2);
  assert.equal(seeds.filter(([a, b]) => a === null && b === null).length, 0, `${entrants} has no empty match`);
}
assert.equal(canConfirmTournamentPayment("PUBLISHED", null), true);
assert.equal(canConfirmTournamentPayment("CANCELLED", null), false);
assert.equal(canConfirmTournamentPayment("IN_PROGRESS", new Date()), false);
console.info("tournament domain tests passed");
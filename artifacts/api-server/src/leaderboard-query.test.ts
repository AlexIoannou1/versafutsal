import assert from "node:assert/strict";
import {
  parseLeaderboardQuery,
  parseLeaderboardSourcesQuery,
} from "./routes/leaderboard";

assert.deepEqual(parseLeaderboardQuery({}), {
  metric: "goals",
  page: 1,
  limit: 20,
}, "an omitted metric defaults to goals");

assert.deepEqual(parseLeaderboardQuery({ metric: "matches" }), {
  metric: "matches",
  page: 1,
  limit: 20,
});

for (const query of [
  { metric: "" },
  { metric: "goals", page: "" },
  { metric: "goals", page: "0" },
  { metric: "goals", page: "1.5" },
  { metric: "goals", limit: "" },
  { metric: "goals", limit: "0" },
  { metric: "goals", limit: "2.5" },
]) {
  assert.equal(parseLeaderboardQuery(query), null, `rejects ${JSON.stringify(query)}`);
}

assert.deepEqual(parseLeaderboardSourcesQuery({}), { page: 1, limit: 20 });
for (const query of [
  { page: "" },
  { page: "0" },
  { page: "1.5" },
  { limit: "" },
  { limit: "0" },
  { limit: "2.5" },
]) {
  assert.equal(parseLeaderboardSourcesQuery(query), null, `rejects ${JSON.stringify(query)}`);
}

console.info("leaderboard query validation checks passed");
import assert from "node:assert/strict";
import { requestSchemas } from "@workspace/api-zod";

assert.equal(requestSchemas["POST /owner/tournaments"].body!.safeParse({
  venueId: "00000000-0000-4000-8000-000000000001", pitchId: "00000000-0000-4000-8000-000000000002",
  name: "Cup", entryType: "TEAM", capacity: 8, registrationDeadline: "2030-01-01T10:00:00.000Z",
  startsAt: "2030-01-02T10:00:00.000Z", endsAt: "2030-01-02T16:00:00.000Z", entryFeeAmount: "10.00", prizePoolAmount: "100.00",
}).success, true);
assert.equal(requestSchemas["POST /tournaments/:id/register"].body!.safeParse({ memberIds: ["x"] }).success, false);
assert.equal(requestSchemas["POST /owner/tournaments/:id/cancel"].params!.safeParse({ id: "bad" }).success, false);
console.info("tournament secure tests passed");
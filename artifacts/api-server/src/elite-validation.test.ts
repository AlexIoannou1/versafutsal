import assert from "node:assert/strict";
import {
  availabilityOverlaps,
  cappedResultLimit,
  isCompleteFivePlayerSquad,
  skillRangesOverlap,
  validSlotStartsInOverlap,
} from "./lib/elite-validation";

const members = ["captain", "two", "three", "four", "five"];
assert.equal(isCompleteFivePlayerSquad("captain", members), true);
assert.equal(isCompleteFivePlayerSquad("captain", members.slice(0, 4)), false);
assert.equal(isCompleteFivePlayerSquad("captain", ["captain", "two", "three", "four", "four"]), false);
assert.equal(isCompleteFivePlayerSquad("outsider", members), false);

assert.equal(skillRangesOverlap(2, 4, 4, 7), true);
assert.equal(skillRangesOverlap(2, 3, 4, 7), false);
const hour = 60 * 60 * 1000;
const at = (n: number) => new Date(Date.UTC(2027, 0, 1) + n * hour);
assert.equal(availabilityOverlaps(
  { startAt: at(1), endAt: at(3), pitchId: "a" },
  { startAt: at(2), endAt: at(4), pitchId: "a" },
), true);
assert.equal(availabilityOverlaps(
  { startAt: at(1), endAt: at(2), pitchId: "a" },
  { startAt: at(2), endAt: at(3), pitchId: "a" },
), false, "adjacent windows do not overlap");
assert.equal(availabilityOverlaps(
  { startAt: at(1), endAt: at(3), pitchId: "a" },
  { startAt: at(2), endAt: at(4), pitchId: "b" },
), false);
assert.equal(cappedResultLimit(500), 100);
assert.equal(cappedResultLimit(-2), 1);
assert.equal(cappedResultLimit(undefined), 50);
assert.deepEqual(validSlotStartsInOverlap({
  overlapStart: at(1), overlapEnd: at(3), pitchId: "a", durationMinutes: 60,
  openTime: "00:00:00", closeTime: "05:00:00", exactA: false, exactB: false,
}).map((date) => date.getTime()), [at(1).getTime(), at(2).getTime()]);
assert.deepEqual(validSlotStartsInOverlap({
  overlapStart: at(1.5), overlapEnd: at(2.5), pitchId: "a", durationMinutes: 60,
  openTime: "00:00:00", closeTime: "05:00:00", exactA: false, exactB: false,
}), [], "non-boundary overlap must not produce an invalid start");

console.info("elite validation tests passed");
import assert from "node:assert/strict";
import { calculateDiscount, isValidPromotionInput, quoteFromDiscount, weekKey } from "./lib/growth-tools";

assert.equal(calculateDiscount("100.00", "PERCENTAGE", "10"), "10.00");
assert.equal(calculateDiscount("19.99", "PERCENTAGE", "33.33"), "6.66");
assert.equal(calculateDiscount("10.00", "FIXED", "12.00"), "10.00");
assert.deepEqual(quoteFromDiscount("10.00", "3.25"), {
  currency: "EUR",
  subtotal: "10.00",
  discountAmount: "3.25",
  payableAmount: "6.75",
  incentiveType: null,
  incentiveId: null,
});
assert.equal(quoteFromDiscount("10.00", "10.00").payableAmount, "0.00");
assert.equal(weekKey(new Date("2025-01-01T12:00:00Z")), "2025-W01");
assert.equal(weekKey(new Date("2025-01-05T12:00:00Z")), "2025-W01");
assert.equal(isValidPromotionInput("SAVE_20", "20.00"), true);
assert.equal(isValidPromotionInput("x", "20.00"), false);
assert.equal(isValidPromotionInput("SAVE", "100000000.00"), false);
assert.equal(isValidPromotionInput("SAVE", "1.234"), false);

console.log("growth tools tests passed");
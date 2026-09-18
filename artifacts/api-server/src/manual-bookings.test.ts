import assert from "node:assert/strict";
import {
  canConfirmOfflinePayment,
  canUsePaymentProvider,
  bookingExportCsv,
  recognizesBookingRevenue,
} from "./lib/manual-bookings";
import { sanitizeBookingAuditData, sanitizeBookingAuditNotes } from "./lib/audit";

assert.equal(canConfirmOfflinePayment("MANUAL", "PENDING"), true);
assert.equal(canConfirmOfflinePayment("MANUAL", "CONFIRMED"), false, "confirmation is not repeatable");
assert.equal(canConfirmOfflinePayment("ONLINE", "PENDING"), false, "online bookings use checkout");
assert.equal(canConfirmOfflinePayment("MANUAL", "CANCELLED"), false);

assert.equal(canUsePaymentProvider("ONLINE"), true);
assert.equal(canUsePaymentProvider("MANUAL"), false, "manual lifecycle is provider-isolated");

assert.equal(recognizesBookingRevenue("MANUAL", "PENDING", null), false);
assert.equal(recognizesBookingRevenue("MANUAL", "CONFIRMED", null), false);
assert.equal(
  recognizesBookingRevenue("MANUAL", "CONFIRMED", new Date("2026-01-01T00:00:00Z")),
  true,
);
assert.equal(recognizesBookingRevenue("ONLINE", "CONFIRMED", null), true);
assert.equal(recognizesBookingRevenue("ONLINE", "REFUNDED", null), false);
const exportCsv = bookingExportCsv([
  { id: "manual-pending", startAt: new Date("2026-01-01T10:00:00Z"), status: "PENDING", source: "MANUAL",
    offlinePaymentReceivedAt: null, venueName: "Venue", pitchName: "Pitch", policySnapshot: { pricePerHour: "40", slotDurationMinutes: 60 }, platformFee: 9 },
  { id: "manual-confirmed", startAt: new Date("2026-01-01T11:00:00Z"), status: "CONFIRMED", source: "MANUAL",
    offlinePaymentReceivedAt: new Date("2026-01-01T09:00:00Z"), venueName: "Venue", pitchName: "Pitch", policySnapshot: { pricePerHour: "40", slotDurationMinutes: 60 }, platformFee: 9 },
]);
assert.match(exportCsv, /"manual-pending".*"0\.00","0\.00","0\.00"/);
assert.match(exportCsv, /"manual-confirmed".*"40\.00","0\.00","40\.00"/);

assert.deepEqual(
  sanitizeBookingAuditData({
    source: "MANUAL",
    guestName: "Private Guest",
    guestPhone: "+35799123456",
    actorEmail: "private@example.test",
    nested: { guestEmail: "private@example.test", status: "PENDING" },
  }),
  { source: "MANUAL", nested: { status: "PENDING" } },
);
assert.deepEqual(
  sanitizeBookingAuditData([{ ContactEmail: "guest@example.test", status: "PENDING" }, { nested: { GuestPhone: "+35799123456", source: "MANUAL" } }]),
  [{ status: "PENDING" }, { nested: { source: "MANUAL" } }],
);
assert.equal(sanitizeBookingAuditNotes("Guest Private Guest +35799123456"), "[redacted operational note]");

console.info("manual booking regression tests passed");
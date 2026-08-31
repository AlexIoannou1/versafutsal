import { z } from "zod";

/** Server input primitives. Text values are NFC-normalised before application code sees them. */
const forbiddenText = /<\s*\/?\s*[a-z!]|(?:--|\/\*)|(?:\bunion\b\s+\bselect\b)|(?:\bdrop\b\s+\btable\b)|(?:\bjavascript\s*:)/i;
const unsafeControl = /\p{Cc}/u;
const forbiddenFormatControl = /[\u202A-\u202E\u2066-\u2069]/u;
const nfc = (value: string) => value.normalize("NFC");
const canonicalText = (min: number, max: number, allowLineBreaks = false) =>
  z
    .string()
    .transform((value) => nfc(value).trim())
    .pipe(z.string().min(min).max(max))
    .refine(
      (value) =>
        ![...value].some(
          (character) =>
            unsafeControl.test(character) &&
            !(allowLineBreaks && "\t\n\r".includes(character)),
        ) &&
        !forbiddenFormatControl.test(value) &&
        !forbiddenText.test(value),
      "unsafe text",
    );
export const plainText = (min = 1, max = 256) => canonicalText(min, max);
export const multilineText = (min = 0, max = 4000) => canonicalText(min, max, true);
// Passwords deliberately retain their exact value: no trim, case folding, or Unicode
// normalization. Control characters are rejected without changing the secret.
export const password = z
  .string()
  .min(6)
  .max(256)
  .refine((value) => !unsafeControl.test(value) && !forbiddenFormatControl.test(value), "unsafe password");
export const uuid = z.string().uuid();
export const providerId = z.string().min(1).max(255).regex(/^[A-Za-z0-9_:-]+$/);
export const phone = z
  .string()
  .transform((value) => nfc(value).trim())
  .pipe(z.string().min(5).max(32))
  .refine((v) => /^\+?[0-9][0-9 ()-]*$/.test(v), "invalid phone");
export const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const isoDate = z
  .string()
  .regex(/^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/)
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return (
      date.getUTCFullYear() === Number(value.slice(0, 4)) &&
      date.getUTCMonth() + 1 === Number(value.slice(5, 7)) &&
      date.getUTCDate() === Number(value.slice(8, 10))
    );
  }, "invalid date");
export const isoDateTime = z.string().datetime({ offset: true });
export const finiteNumber = (min: number, max: number) => z.number().finite().min(min).max(max);

const role = z.enum(["PLAYER", "VENUE_OWNER"]);
const pitchType = z.enum(["INDOOR", "OUTDOOR", "HYBRID"]);
const bookingStatus = z.enum(["PENDING", "CONFIRMED", "CANCELLED", "REFUNDED", "NO_SHOW"]);
const venueStatus = z.enum(["PENDING", "APPROVED", "REJECTED", "DISABLED"]);
const strict = <T extends z.ZodRawShape>(shape: T) => z.object(shape).strict();
const empty = strict({});
const queryNumber = (min: number, max: number) =>
  z
    .string()
    .min(1)
    .regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/)
    .transform(Number)
    .pipe(z.number().finite().min(min).max(max));
const priceText = z.string().regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/);
const reason = multilineText(1, 1000);
const dateQuery = z.union([isoDate, isoDateTime]);

export const requestSchemas = {
  "POST /auth/register": { body: strict({ email: z.string().email().max(254).transform((v) => nfc(v).toLowerCase()), password, name: plainText(1, 120), role: role.optional(), phoneNumber: phone.optional() }) },
  "POST /auth/login": { body: strict({ email: z.string().email().max(254).transform((v) => nfc(v).toLowerCase()), password }) },
  "PATCH /auth/profile": { body: strict({ name: plainText(1, 120).optional(), email: z.string().email().max(254).transform((v) => nfc(v).toLowerCase()).optional(), phoneNumber: phone.optional(), city: plainText(1, 120).nullable().optional() }).refine((v) => Object.keys(v).length > 0) },
  "PATCH /auth/password": { body: strict({ currentPassword: password, newPassword: password }) },
  "PATCH /auth/push-token": { body: strict({ pushToken: z.string().min(1).max(512).regex(/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/) }) },
  "DELETE /auth/push-token": {},
  "GET /venues": { query: strict({ district: plainText(1, 120).optional(), type: pitchType.optional(), minPrice: queryNumber(0, 100000).optional(), maxPrice: queryNumber(0, 100000).optional() }) },
  "GET /venues/:id": { params: strict({ id: uuid }) },
  "GET /venues/:venueId/pitches/:pitchId/availability": { params: strict({ venueId: uuid, pitchId: uuid }), query: strict({ date: isoDate }) },
  "POST /owner/venues": { body: strict({ name: plainText(1, 160), district: plainText(1, 120), address: plainText(1, 300), description: multilineText(0, 4000).optional(), amenities: z.array(plainText(1, 80)).max(50).optional(), cancellationWindowHours: z.number().int().min(0).max(168).optional(), contactPhone: phone }) },
  "PUT /owner/venues/:id": { params: strict({ id: uuid }), body: strict({ name: plainText(1, 160).optional(), district: plainText(1, 120).optional(), address: plainText(1, 300).optional(), description: multilineText(0, 4000).optional(), amenities: z.array(plainText(1, 80)).max(50).optional(), cancellationWindowHours: z.number().int().min(0).max(168).optional(), contactPhone: phone.optional() }) },
  "POST /owner/venues/:id/pitches": { params: strict({ id: uuid }), body: strict({ name: plainText(1, 120), size: plainText(1, 80), type: pitchType.optional(), slotDurationMinutes: z.number().int().min(15).max(240).optional() }) },
  "PUT /owner/venues/:id/pitches/:pitchId": { params: strict({ id: uuid, pitchId: uuid }), body: strict({ name: plainText(1, 120).optional(), size: plainText(1, 80).optional(), type: pitchType.optional(), slotDurationMinutes: z.number().int().min(15).max(240).optional() }) },
  "PUT /owner/venues/:id/opening-hours": { params: strict({ id: uuid }), body: strict({ hours: z.array(strict({ dayOfWeek: z.number().int().min(0).max(6), openTime: time, closeTime: time, isClosed: z.boolean() })).min(1).max(7) }) },
  "PUT /owner/venues/:id/pitches/:pitchId/pricing": { params: strict({ id: uuid, pitchId: uuid }), body: strict({ rules: z.array(strict({ dayType: z.enum(["WEEKDAY", "WEEKEND", "ALL"]), pricePerHour: priceText, depositType: z.enum(["NONE", "FIXED", "PERCENT"]), depositAmount: priceText.nullable().optional() })).max(50) }) },
  "PUT /owner/venues/:id/photos/reorder": { params: strict({ id: uuid }), body: strict({ orderedIds: z.array(uuid).max(7) }) },
  "POST /bookings": { body: strict({ pitchId: uuid, startAt: isoDateTime }) },
  "POST /owner/bookings/manual": { body: strict({ pitchId: uuid, startAt: isoDateTime, guestName: plainText(1, 120), guestPhone: phone }) },
  "PUT /owner/bookings/:id": { params: strict({ id: uuid }), body: strict({ pitchId: uuid, startAt: isoDateTime, guestName: plainText(1, 120).nullable().optional(), guestPhone: phone.nullable().optional() }) },
  "POST /bookings/:id/cancel": { params: strict({ id: uuid }), body: strict({ reason: reason.optional() }) },
  "POST /owner/venues/:venueId/pitches/:pitchId/blocks": { params: strict({ venueId: uuid, pitchId: uuid }), body: strict({ startAt: isoDateTime, endAt: isoDateTime, reason: reason.optional() }) },
  "POST /owner/venues/:venueId/blocks": { params: strict({ venueId: uuid }), body: strict({ pitchId: uuid.nullable().optional(), blockType: z.enum(["OFF_DAY", "BANK_HOLIDAY", "TRAINING", "MAINTENANCE", "PRIVATE"]).optional(), label: plainText(1, 160).optional(), startDate: isoDate, endDate: isoDate, startTime: time.optional(), endTime: time.optional(), recursWeekly: z.boolean().optional(), dayOfWeek: z.number().int().min(0).max(6).optional() }) },
  "GET /player/bookings": { query: strict({ status: bookingStatus.optional() }) },
  "GET /owner/stats": { query: strict({ from: dateQuery.optional(), to: dateQuery.optional() }) },
  "GET /owner/bookings": { query: strict({ status: bookingStatus.optional(), from: dateQuery.optional(), to: dateQuery.optional(), pitchId: uuid.optional() }) },
  "GET /admin/bookings": { query: strict({ status: bookingStatus.optional(), from: dateQuery.optional(), to: dateQuery.optional() }) },
  "GET /admin/users": { query: strict({ search: plainText(1, 120).optional(), role: role.optional(), page: queryNumber(1, 100000).refine(Number.isInteger).optional(), limit: queryNumber(1, 100).refine(Number.isInteger).optional() }) },
  "GET /admin/venues": { query: strict({ status: venueStatus.optional() }) },
  "PUT /admin/venues/:id/reject": { params: strict({ id: uuid }), body: strict({ reason: multilineText(1, 1000).optional() }) },
  "PUT /admin/venues/:id/disable": { params: strict({ id: uuid }), body: strict({ reason: multilineText(1, 1000) }) },
  "POST /admin/bookings/:id/refund": { params: strict({ id: uuid }), body: strict({ reason: multilineText(1, 1000).optional() }) },
  "PATCH /admin/settings": { body: strict({ feeEnabled: z.boolean().optional(), feePercent: z.union([finiteNumber(0, 100), z.string().regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/)]).optional() }) },
  "PATCH /admin/settings/venues/:venueId": { params: strict({ venueId: uuid }), body: strict({ feeEnabled: z.boolean().nullable().optional() }) },
  "GET /checkout/fee": { query: strict({ venueId: uuid.optional() }) },
  "POST /bookings/:bookingId/checkout": { params: strict({ bookingId: uuid }), body: strict({ paymentType: z.enum(["FULL", "DEPOSIT"]).optional(), idempotencyKey: providerId.optional() }) },
  "POST /bookings/:bookingId/capture": { params: strict({ bookingId: uuid }), body: empty },
  "POST /player/notifications/read": { body: strict({ id: uuid.optional() }) },
  "PATCH /player/notifications/read": { body: strict({ id: uuid.optional() }) },
  "PATCH /owner/notifications/read": { body: strict({ id: uuid.optional() }) },
} as const;

export type RequestSchemaKey = keyof typeof requestSchemas;
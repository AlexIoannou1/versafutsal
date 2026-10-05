import { z } from "zod";
import { normalizePhoneNumber } from "./phone";

/** Server input primitives. Text values are NFC-normalised before application code sees them. */
const forbiddenText = /<\s*\/?\s*[a-z!]|(?:--|\/\*)|(?:\bunion\b\s+\bselect\b)|(?:\bdrop\b\s+\btable\b)|(?:\bjavascript\s*:)/i;
const unsafeControl = /\p{Cc}/u;
const unsafePasswordCharacters = /[\p{Cc}\p{Cf}]/u;
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

export const PASSWORD_POLICY_VERSION = "2026-01";
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_RECOMMENDED_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/**
 * This deliberately small, versioned list catches passwords that are commonly
 * guessed without sending password values to an external service. Matching is
 * case-insensitive, but password bytes are never transformed or persisted here.
 */
const COMMON_PASSWORD_DENYLIST = new Set([
  "00000000",
  "11111111",
  "12345678",
  "123456789",
  "1234567890",
  "abc12345",
  "admin123",
  "dragon",
  "football",
  "iloveyou",
  "letmein",
  "monkey",
  "passw0rd",
  "password",
  "password1",
  "password123",
  "princess",
  "qwerty123",
  "qwertyuiop",
  "sunshine",
  "welcome",
]);

export type PasswordPolicyIssue =
  | "PASSWORD_TOO_SHORT"
  | "PASSWORD_TOO_LONG"
  | "PASSWORD_UNSAFE_CHARACTERS"
  | "PASSWORD_TOO_COMMON";

export type PasswordStrength = "invalid" | "weak" | "fair" | "good" | "strong";

export type NewPasswordAssessment = {
  accepted: boolean;
  issue?: PasswordPolicyIssue;
  strength: PasswordStrength;
  guidance: string;
};

export function passwordPolicyErrorMessage(issue: PasswordPolicyIssue): string {
  switch (issue) {
    case "PASSWORD_TOO_SHORT":
      return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
    case "PASSWORD_TOO_LONG":
      return `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`;
    case "PASSWORD_UNSAFE_CHARACTERS":
      return "Password contains unsupported control characters.";
    case "PASSWORD_TOO_COMMON":
      return "That password is too common. Choose a different one.";
  }
}

/**
 * Assess a new password without logging, normalizing, or otherwise changing it.
 * Login/current-password input deliberately uses credentialPassword instead.
 */
export function assessNewPassword(value: string): NewPasswordAssessment {
  if (value.length < PASSWORD_MIN_LENGTH) {
    return {
      accepted: false,
      issue: "PASSWORD_TOO_SHORT",
      strength: "invalid",
      guidance: `Use at least ${PASSWORD_MIN_LENGTH} characters. ${PASSWORD_RECOMMENDED_LENGTH}+ is recommended.`,
    };
  }
  if (value.length > PASSWORD_MAX_LENGTH) {
    return {
      accepted: false,
      issue: "PASSWORD_TOO_LONG",
      strength: "invalid",
      guidance: `Use ${PASSWORD_MAX_LENGTH} characters or fewer.`,
    };
  }
  if (unsafePasswordCharacters.test(value)) {
    return {
      accepted: false,
      issue: "PASSWORD_UNSAFE_CHARACTERS",
      strength: "invalid",
      guidance: "Remove control or invisible formatting characters and try again.",
    };
  }
  if (COMMON_PASSWORD_DENYLIST.has(value.toLocaleLowerCase("en-US"))) {
    return {
      accepted: false,
      issue: "PASSWORD_TOO_COMMON",
      strength: "invalid",
      guidance: "Choose a password that is not commonly used.",
    };
  }

  if (value.length < PASSWORD_RECOMMENDED_LENGTH) {
    return {
      accepted: true,
      strength: "weak",
      guidance: `${PASSWORD_RECOMMENDED_LENGTH}+ characters is recommended for stronger protection.`,
    };
  }

  const uniqueCharacters = new Set([...value]).size;
  if (value.length >= 20 || (value.length >= 16 && uniqueCharacters >= 8)) {
    return { accepted: true, strength: "strong", guidance: "Strong password." };
  }
  if (value.length >= 14 || uniqueCharacters >= 7) {
    return { accepted: true, strength: "good", guidance: "Good password length." };
  }
  return {
    accepted: true,
    strength: "fair",
    guidance: "Good start. A longer password is even stronger.",
  };
}

// Credential input intentionally remains separate from the new-password policy:
// existing users can sign in with legacy credentials and verify their current password.
export const credentialPassword = z.string().min(1).max(PASSWORD_MAX_LENGTH);
export const newPassword = credentialPassword.superRefine((value, ctx) => {
  const assessment = assessNewPassword(value);
  if (!assessment.accepted) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: assessment.issue!,
    });
  }
});
// Retained for callers that only need a credential-input validator.
export const password = credentialPassword;
export const uuid = z.string().uuid();
export const providerId = z.string().min(1).max(255).regex(/^[A-Za-z0-9_:-]+$/);
export const phone = z
  .string()
  .transform((value) => nfc(value).trim())
  .pipe(z.string().min(5).max(32))
  .refine((v) => /^\+?[0-9][0-9 ()-]*$/.test(v), "invalid phone");
export const accountPhone = z
  .string()
  .transform((value, ctx) => {
    try {
      return normalizePhoneNumber(value);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "invalid phone" });
      return z.NEVER;
    }
  });
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
const subscriptionPlan = z.enum(["FREE", "PRO", "ELITE"]);
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
  "POST /auth/register": { body: strict({ email: z.string().email().max(254).transform((v) => nfc(v).toLowerCase()), password: newPassword, name: plainText(1, 120), role: role.optional(), phoneNumber: accountPhone }) },
  "POST /auth/login": { body: strict({ email: z.string().email().max(254).transform((v) => nfc(v).toLowerCase()), password: credentialPassword }) },
  "POST /auth/password-reset/request": { body: strict({ email: z.string().email().max(254).transform((v) => nfc(v).toLowerCase()) }) },
  "POST /auth/password-reset/confirm": { body: strict({ token: z.string().regex(/^[A-Za-z0-9_-]{40,60}$/), newPassword }) },
  "PATCH /auth/profile": { body: strict({ name: plainText(1, 120).optional(), email: z.string().email().max(254).transform((v) => nfc(v).toLowerCase()).optional(), phoneNumber: accountPhone.optional(), city: plainText(1, 120).nullable().optional() }).refine((v) => Object.keys(v).length > 0) },
  "PATCH /auth/password": { body: strict({ currentPassword: credentialPassword, newPassword }) },
  "PATCH /auth/push-token": { body: strict({ pushToken: z.string().min(1).max(512).regex(/^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/) }) },
  "DELETE /auth/push-token": {},
  "GET /venues": { query: strict({ district: plainText(1, 120).optional(), type: pitchType.optional(), minPrice: queryNumber(0, 100000).optional(), maxPrice: queryNumber(0, 100000).optional() }) },
  "GET /venues/:id": { params: strict({ id: uuid }) },
  "GET /venues/:venueId/pitches/:pitchId/availability": { params: strict({ venueId: uuid, pitchId: uuid }), query: strict({ date: isoDate }) },
  "POST /owner/venues": { body: strict({ name: plainText(1, 160), district: plainText(1, 120), address: plainText(1, 300), description: multilineText(0, 4000).optional(), amenities: z.array(plainText(1, 80)).max(50).optional(), cancellationWindowHours: z.number().int().min(0).max(168).optional(), contactPhone: phone, streakEnabled: z.boolean().optional() }) },
  "PUT /owner/venues/:id": { params: strict({ id: uuid }), body: strict({ name: plainText(1, 160).optional(), district: plainText(1, 120).optional(), address: plainText(1, 300).optional(), description: multilineText(0, 4000).optional(), amenities: z.array(plainText(1, 80)).max(50).optional(), cancellationWindowHours: z.number().int().min(0).max(168).optional(), contactPhone: phone.optional() }) },
  "POST /owner/venues/:id/pitches": { params: strict({ id: uuid }), body: strict({ name: plainText(1, 120), size: plainText(1, 80), type: pitchType.optional(), slotDurationMinutes: z.number().int().min(15).max(240).optional() }) },
  "PUT /owner/venues/:id/pitches/:pitchId": { params: strict({ id: uuid, pitchId: uuid }), body: strict({ name: plainText(1, 120).optional(), size: plainText(1, 80).optional(), type: pitchType.optional(), slotDurationMinutes: z.number().int().min(15).max(240).optional() }) },
  "PUT /owner/venues/:id/opening-hours": { params: strict({ id: uuid }), body: strict({ hours: z.array(strict({ dayOfWeek: z.number().int().min(0).max(6), openTime: time, closeTime: time, isClosed: z.boolean() })).min(1).max(7) }) },
  "PUT /owner/venues/:id/pitches/:pitchId/pricing": { params: strict({ id: uuid, pitchId: uuid }), body: strict({ rules: z.array(strict({ dayType: z.enum(["WEEKDAY", "WEEKEND", "ALL"]), pricePerHour: priceText, depositType: z.enum(["NONE", "FIXED", "PERCENT"]), depositAmount: priceText.nullable().optional() })).max(50) }) },
  "PUT /owner/venues/:id/photos/reorder": { params: strict({ id: uuid }), body: strict({ orderedIds: z.array(uuid).max(7) }) },
  "POST /bookings": { body: strict({ pitchId: uuid, startAt: isoDateTime }) },
  "POST /owner/bookings/manual": { body: strict({ pitchId: uuid, startAt: isoDateTime, guestName: plainText(1, 120), guestPhone: phone }) },
  "POST /owner/bookings/:id/confirm-offline-payment": { params: strict({ id: uuid }) },
  "PUT /owner/bookings/:id": { params: strict({ id: uuid }), body: strict({ pitchId: uuid, startAt: isoDateTime, guestName: plainText(1, 120).nullable().optional(), guestPhone: phone.nullable().optional() }) },
  "POST /bookings/:id/cancel": { params: strict({ id: uuid }), body: strict({ reason: reason.optional() }) },
  "POST /owner/venues/:venueId/pitches/:pitchId/blocks": { params: strict({ venueId: uuid, pitchId: uuid }), body: strict({ startAt: isoDateTime, endAt: isoDateTime, reason: reason.optional() }) },
  "POST /owner/venues/:venueId/blocks": { params: strict({ venueId: uuid }), body: strict({ pitchId: uuid.nullable().optional(), blockType: z.enum(["OFF_DAY", "BANK_HOLIDAY", "TRAINING", "MAINTENANCE", "PRIVATE"]).optional(), label: plainText(1, 160).optional(), startDate: isoDate, endDate: isoDate, startTime: time.optional(), endTime: time.optional(), recursWeekly: z.boolean().optional(), dayOfWeek: z.number().int().min(0).max(6).optional() }) },
  "GET /player/bookings": { query: strict({ status: bookingStatus.optional() }) },
  "GET /owner/stats": { query: strict({ from: dateQuery.optional(), to: dateQuery.optional() }) },
  "GET /owner/bookings": { query: strict({ status: bookingStatus.optional(), from: dateQuery.optional(), to: dateQuery.optional(), pitchId: uuid.optional() }) },
  "GET /owner/bookings/export.csv": { query: strict({ status: bookingStatus.optional(), from: dateQuery.optional(), to: dateQuery.optional() }) },
  "GET /admin/bookings": { query: strict({ status: bookingStatus.optional(), from: dateQuery.optional(), to: dateQuery.optional() }) },
  "GET /admin/bookings/export.csv": { query: strict({ status: bookingStatus.optional(), from: dateQuery.optional(), to: dateQuery.optional() }) },
  "GET /admin/users": { query: strict({ search: plainText(1, 120).optional(), role: role.optional(), page: queryNumber(1, 100000).refine(Number.isInteger).optional(), limit: queryNumber(1, 100).refine(Number.isInteger).optional() }) },
  "GET /admin/venues": { query: strict({ status: venueStatus.optional() }) },
  "PUT /admin/venues/:id/reject": { params: strict({ id: uuid }), body: strict({ reason: multilineText(1, 1000).optional() }) },
  "PUT /admin/venues/:id/disable": { params: strict({ id: uuid }), body: strict({ reason: multilineText(1, 1000) }) },
  "POST /admin/bookings/:id/refund": { params: strict({ id: uuid }), body: strict({ reason: multilineText(1, 1000).optional() }) },
  "PATCH /admin/settings": { body: strict({ feeEnabled: z.boolean().optional(), feePercent: z.union([finiteNumber(0, 100), z.string().regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/)]).optional() }) },
  "PATCH /admin/settings/venues/:venueId": { params: strict({ venueId: uuid }), body: strict({ feeEnabled: z.boolean().nullable().optional() }) },
  "GET /checkout/fee": { query: strict({ venueId: uuid.optional() }) },
  "POST /bookings/:bookingId/checkout": { params: strict({ bookingId: uuid }), body: strict({ paymentType: z.enum(["FULL", "DEPOSIT"]).optional(), idempotencyKey: providerId.optional(), promoCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/).optional(), useStreakReward: z.boolean().optional() }) },
  "POST /bookings/:bookingId/quote": { params: strict({ bookingId: uuid }), body: strict({ promoCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/).optional() }) },
  "POST /growth/quote": { body: strict({ pitchId: uuid, startAt: isoDateTime, promoCode: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/).optional() }) },
  "POST /owner/promotions": { body: strict({
    venueId: uuid, code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/),
    kind: z.enum(["PERCENTAGE", "FIXED"]), value: finiteNumber(0.01, 99999999.99),
    startsAt: isoDateTime.nullable().optional(), endsAt: isoDateTime.nullable().optional(),
    redemptionLimit: z.number().int().min(1).max(2147483647).nullable().optional(),
    perPlayerLimit: z.number().int().min(1).max(2147483647).optional(),
  }) },
  "PATCH /owner/promotions/:id": { params: strict({ id: uuid }), body: strict({
    enabled: z.boolean().optional(), code: z.string().trim().toUpperCase().regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/).optional(),
    kind: z.enum(["PERCENTAGE", "FIXED"]).optional(), value: finiteNumber(0.01, 99999999.99).optional(),
    endsAt: isoDateTime.nullable().optional(),
    redemptionLimit: z.number().int().min(1).max(2147483647).nullable().optional(),
    perPlayerLimit: z.number().int().min(1).max(2147483647).optional(),
  }).refine((body) => Object.keys(body).length > 0) },
  "DELETE /owner/promotions/:id": { params: strict({ id: uuid }) },
  "PUT /owner/venues/:id/streak": { params: strict({ id: uuid }), body: strict({ enabled: z.boolean() }) },
  "GET /player/venues/:venueId/streak": { params: strict({ venueId: uuid }) },
  "POST /bookings/:bookingId/capture": { params: strict({ bookingId: uuid }), body: empty },
  "POST /player/notifications/read": { body: strict({ id: uuid.optional() }) },
  "PATCH /player/notifications/read": { body: strict({ id: uuid.optional() }) },
  "PATCH /owner/notifications/read": { body: strict({ id: uuid.optional() }) },
  "GET /owner/subscription": {},
  "POST /owner/subscription/checkout": { body: strict({ plan: z.enum(["PRO", "ELITE"]) }) },
  "POST /owner/subscription/portal": { body: empty },
  "POST /owner/subscription/cancel": { body: empty },
  "GET /admin/subscriptions/owners": { query: strict({ plan: subscriptionPlan.optional() }) },
  "GET /admin/subscriptions/owners/:ownerId": { params: strict({ ownerId: uuid }) },
  "PUT /admin/subscriptions/owners/:ownerId/override": {
    params: strict({ ownerId: uuid }),
    body: strict({
      plan: subscriptionPlan.nullable(),
      reason,
      startsAt: isoDateTime.nullable().optional(),
      endsAt: isoDateTime.nullable().optional(),
    }),
  },
  "POST /owner/tournaments": { body: strict({ venueId: uuid, pitchId: uuid, name: plainText(1, 160), description: multilineText(0, 4000).optional(), entryType: z.enum(["PLAYER", "TEAM"]), capacity: z.number().int().min(2).max(256), registrationDeadline: isoDateTime, startsAt: isoDateTime, endsAt: isoDateTime, entryFeeAmount: priceText, prizePoolAmount: priceText }) },
  "GET /owner/tournaments/:id": { params: strict({ id: uuid }) },
  "PUT /owner/tournaments/:id": { params: strict({ id: uuid }), body: strict({ venueId: uuid, pitchId: uuid, name: plainText(1, 160), description: multilineText(0, 4000).optional(), entryType: z.enum(["PLAYER", "TEAM"]), capacity: z.number().int().min(2).max(256), registrationDeadline: isoDateTime, startsAt: isoDateTime, endsAt: isoDateTime, entryFeeAmount: priceText, prizePoolAmount: priceText }) },
  "DELETE /owner/tournaments/:id": { params: strict({ id: uuid }) },
  "POST /owner/tournaments/:id/publish": { params: strict({ id: uuid }), body: empty },
  "POST /owner/tournaments/:id/close": { params: strict({ id: uuid }), body: empty },
  "POST /owner/tournaments/:id/bracket": { params: strict({ id: uuid }), body: empty },
  "POST /tournaments/:id/register": { params: strict({ id: uuid }), body: strict({ teamName: plainText(1, 100).optional() }) },
  "POST /tournament-registrations/:id/checkout": { params: strict({ id: uuid }), body: strict({ idempotencyKey: providerId }) },
  "POST /tournament-registrations/:id/capture": { params: strict({ id: uuid }), body: empty },
  "PUT /owner/tournaments/:id/matches/:matchId": { params: strict({ id: uuid, matchId: uuid }), body: strict({ startAt: isoDateTime, endAt: isoDateTime }) },
  "POST /owner/tournaments/:id/matches/:matchId/result": { params: strict({ id: uuid, matchId: uuid }), body: strict({ winnerRegistrationId: uuid, score: z.record(z.string(), z.number().int().min(0)) }) },
  "POST /owner/tournaments/:id/cancel": { params: strict({ id: uuid }), body: strict({ reason }) },
} as const;

export type RequestSchemaKey = keyof typeof requestSchemas;

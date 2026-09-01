import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import pino from "pino";
import {
  assessNewPassword,
  credentialPassword,
  newPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  requestSchemas,
  plainText,
  multilineText,
  normalizePhoneNumber,
} from "@workspace/api-zod";
import { LOG_REDACT_PATHS } from "./lib/logger";
import { BCRYPT_COST, hashNewPassword, verifyPassword } from "./lib/passwords";
import { requestParseError, requestValidation } from "./middlewares/request-validation";

const register = requestSchemas["POST /auth/register"].body;
const login = requestSchemas["POST /auth/login"].body;
const changePassword = requestSchemas["PATCH /auth/password"].body;
const venue = requestSchemas["POST /owner/venues"].body;
const listVenues = requestSchemas["GET /venues"].query;

assert(register);
assert(login);
assert(changePassword);
assert(venue);
assert(listVenues);

const greekName = "Μαρία Καφέ́"; // includes a combining accent
const accepted = register.safeParse({
  email: "MARIA@example.com",
  password: "  strong secret  ",
  name: greekName,
  role: "PLAYER",
  phoneNumber: "99123456",
});
assert.equal(accepted.success, true);
if (accepted.success) {
  assert.equal(accepted.data.email, "maria@example.com");
  assert.equal(accepted.data.password, "  strong secret  ");
  assert.equal(accepted.data.name, greekName.normalize("NFC"));
  assert.equal(accepted.data.phoneNumber, "+35799123456");
}

assert.equal(plainText().safeParse("   ").success, false);
assert.equal(plainText().safeParse("<script>alert(1)</script>").success, false);
assert.equal(plainText().safeParse("<ScRiPt>alert(1)</ScRiPt>").success, false);
assert.equal(plainText().safeParse("\u0000name").success, false);
assert.equal(plainText().safeParse("line\nbreak").success, false);
assert.equal(multilineText().safeParse("line\nbreak").success, true);
for (const control of ["\u0080", "\u0085", "\u009F"]) {
  assert.equal(plainText().safeParse(`safe${control}text`).success, false);
  assert.equal(newPassword.safeParse(`secure-pass${control}`).success, false);
}
assert.equal(plainText().safeParse("spoof\u202Etxet").success, false);
assert.equal(plainText().safeParse("Καφέ 'Ορίζοντες' - Λευκωσία").success, true);
assert.equal(credentialPassword.safeParse("secret").success, true);
assert.equal(credentialPassword.safeParse("secret\u0000").success, true);
assert.equal(credentialPassword.safeParse("secret\n").success, true);
assert.equal(credentialPassword.safeParse(123456).success, false);

assert.equal(newPassword.safeParse("1234567").success, false);
assert.equal(newPassword.safeParse("password123").success, false);
assert.equal(newPassword.safeParse("secure\u0000password").success, false);
assert.equal(newPassword.safeParse("secure\u200Bpassword").success, false);
assert.equal(newPassword.safeParse("x".repeat(64)).success, true);
assert.equal(newPassword.safeParse("x".repeat(PASSWORD_MAX_LENGTH)).success, true);
assert.equal(newPassword.safeParse("x".repeat(PASSWORD_MAX_LENGTH + 1)).success, false);
assert.equal(assessNewPassword("abcdefgh").accepted, true);
assert.equal(assessNewPassword("abcdefgh").strength, "weak");
assert.equal(assessNewPassword("password123").issue, "PASSWORD_TOO_COMMON");
assert.equal(assessNewPassword("x".repeat(PASSWORD_MIN_LENGTH - 1)).issue, "PASSWORD_TOO_SHORT");

assert.equal(login.safeParse({ email: "legacy@example.com", password: "legacy" }).success, true);
assert.equal(changePassword.safeParse({
  currentPassword: "legacy",
  newPassword: "a-valid-new-password",
}).success, true);
assert.equal(changePassword.safeParse({
  currentPassword: "legacy",
  newPassword: "password123",
}).success, false);

const bcryptHash = await hashNewPassword("a-valid-new-password");
assert.equal(bcrypt.getRounds(bcryptHash), BCRYPT_COST);
assert.equal(await verifyPassword("a-valid-new-password", bcryptHash), true);
assert.equal(await verifyPassword("another-password", bcryptHash), false);
const longPassword = "x".repeat(255) + "a";
const distinctLongPassword = "x".repeat(255) + "b";
const longPasswordHash = await hashNewPassword(longPassword);
assert.equal(await verifyPassword(longPassword, longPasswordHash), true);
assert.equal(await verifyPassword(distinctLongPassword, longPasswordHash), false);
const legacyHash = await bcrypt.hash("legacy", BCRYPT_COST);
assert.equal(await verifyPassword("legacy", legacyHash), true);
const legacyLongPassword = "l".repeat(64);
const legacyLongHash = await bcrypt.hash(legacyLongPassword, BCRYPT_COST);
assert.equal(await verifyPassword(legacyLongPassword, legacyLongHash), true);

assert.equal(register.safeParse({
  email: "player@example.com",
  password: "secret",
  name: "Player",
  unexpected: "reject me",
}).success, false);
assert.equal(register.safeParse({
  email: "player@example.com",
  password: "secret",
  name: "Player",
}).success, false);
assert.equal(register.safeParse({
  email: "player@example.com",
  password: "secret",
  name: "Player",
  phoneNumber: "123",
}).success, false);
assert.equal(normalizePhoneNumber("+357 99 123456"), "+35799123456");
assert.equal(normalizePhoneNumber("00357 99 123456"), "+35799123456");
assert.equal(login.safeParse({ email: "not-an-email", password: "secret" }).success, false);
assert.equal(venue.safeParse({
  name: "Venue",
  district: "Nicosia",
  address: "Address",
  contactPhone: "+357 99 123456",
  amenities: ["<img src=x>"],
}).success, false);
assert.equal(listVenues.safeParse({ minPrice: "12abc" }).success, false);
assert.equal(listVenues.safeParse({ minPrice: "12.50" }).success, true);
assert.equal(requestSchemas["GET /venues/:venueId/pitches/:pitchId/availability"].query?.safeParse({ date: "2024-02-31" }).success, false);
assert.equal(requestSchemas["GET /venues/:venueId/pitches/:pitchId/availability"].query?.safeParse({ date: "2024-02-29" }).success, true);
assert.equal(requestSchemas["GET /venues/:id"].params?.safeParse({ id: "not-a-uuid" }).success, false);
assert.equal(requestSchemas["GET /venues/:id"].params?.safeParse({
  id: "2a6f4f1e-8f8b-4d93-9d1a-1b9d62a3c1e2",
}).success, true);

let parserResponse: { statusCode?: number; body?: unknown } = {};
const parserRes = {
  status(code: number) {
    parserResponse.statusCode = code;
    return this;
  },
  json(body: unknown) {
    parserResponse.body = body;
    return this;
  },
} as never;
let parserNextCalled = false;
requestParseError({ status: 413 }, {} as never, parserRes, () => {
  parserNextCalled = true;
});
assert.equal(parserNextCalled, false);
assert.deepEqual(parserResponse, {
  statusCode: 400,
  body: { error: "Invalid request input", code: "REQUEST_BODY_INVALID" },
});

let policyResponse: { statusCode?: number; body?: unknown } = {};
const policyRes = {
  status(code: number) {
    policyResponse.statusCode = code;
    return this;
  },
  json(body: unknown) {
    policyResponse.body = body;
    return this;
  },
} as never;
requestValidation({
  method: "POST",
  path: "/auth/register",
  body: { password: "password123" },
  query: {},
  params: {},
  is: () => false,
} as never, policyRes, () => {
  throw new Error("Common password must not reach the registration route");
});
assert.deepEqual(policyResponse, {
  statusCode: 400,
  body: {
    error: "That password is too common. Choose a different one.",
    code: "PASSWORD_TOO_COMMON",
    field: "password",
  },
});

const secretProbe = "must-not-appear-in-logs";
const emailProbe = "person@example.test";
const logChunks: string[] = [];
const redactionProbe = pino(
  { redact: LOG_REDACT_PATHS },
  { write(chunk: string) { logChunks.push(chunk); } },
);
redactionProbe.info({
  req: { body: { password: secretProbe } },
  password: secretProbe,
  currentPassword: secretProbe,
  newPassword: secretProbe,
  token: secretProbe,
  email: emailProbe,
  user: { email: emailProbe, name: "Private Name", phoneNumber: "+35799123456" },
});
assert.equal(logChunks.join("").includes(secretProbe), false);
assert.equal(logChunks.join("").includes(emailProbe), false);
assert.equal(logChunks.join("").includes("Private Name"), false);
assert.equal(logChunks.join("").includes("[Redacted]"), true);

console.log("secure input validation regression checks passed");

import assert from "node:assert/strict";
import {
  requestSchemas,
  plainText,
  multilineText,
  password,
  normalizePhoneNumber,
} from "@workspace/api-zod";
import { requestParseError } from "./middlewares/request-validation";

const register = requestSchemas["POST /auth/register"].body;
const login = requestSchemas["POST /auth/login"].body;
const venue = requestSchemas["POST /owner/venues"].body;
const listVenues = requestSchemas["GET /venues"].query;

assert(register);
assert(login);
assert(venue);
assert(listVenues);

const greekName = "Μαρία Καφέ́"; // includes a combining accent
const accepted = register.safeParse({
  email: "MARIA@example.com",
  password: "  secret  ",
  name: greekName,
  role: "PLAYER",
  phoneNumber: "99123456",
});
assert.equal(accepted.success, true);
if (accepted.success) {
  assert.equal(accepted.data.email, "maria@example.com");
  assert.equal(accepted.data.password, "  secret  ");
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
  assert.equal(password.safeParse(`secret${control}`).success, false);
}
assert.equal(plainText().safeParse("spoof\u202Etxet").success, false);
assert.equal(plainText().safeParse("Καφέ 'Ορίζοντες' - Λευκωσία").success, true);
assert.equal(password.safeParse("secret").success, true);
assert.equal(password.safeParse("secret\u0000").success, false);
assert.equal(password.safeParse("secret\n").success, false);
assert.equal(password.safeParse(123456).success, false);

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

console.log("secure input validation regression checks passed");

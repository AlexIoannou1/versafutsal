import assert from "node:assert/strict";
import { createRequire } from "node:module";

(globalThis as typeof globalThis & { require: NodeJS.Require }).require = createRequire(import.meta.url);
const { StripePaymentProvider } = await import("./lib/payment-provider");
const provider = new StripePaymentProvider("test-only");
let status = "processing";
let failRetrieve = false;
let cancelCalls = 0;
// Provider boundary stub: no network calls, credentials, charges, or refunds.
(provider as any).stripe = {
  paymentIntents: {
    retrieve: async () => {
      if (failRetrieve) throw new Error("network unavailable");
      return { status, client_secret: status === "canceled" ? null : "test-only" };
    },
    cancel: async () => { cancelCalls++; status = "canceled"; return { status }; },
  },
};
for (const protectedStatus of ["processing", "succeeded", "requires_capture"]) {
  status = protectedStatus;
  assert.equal(await provider.cancelUnpaidIntent("test-only"), false);
}
assert.equal(cancelCalls, 0, "in-flight/succeeded payments must never release incentives");
status = "requires_action";
assert.equal((await provider.confirmPayment("test-only")).terminal, undefined);
assert.equal(await provider.cancelUnpaidIntent("test-only"), true);
assert.equal(cancelCalls, 1);
assert.equal((await provider.confirmPayment("test-only")).terminal, true);
failRetrieve = true;
assert.equal((await provider.confirmPayment("test-only")).terminal, undefined);
await assert.rejects(provider.cancelUnpaidIntent("test-only"));
console.log("growth payment-state checks passed");

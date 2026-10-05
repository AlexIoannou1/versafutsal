import { db } from "@workspace/db";
import {
  paymentsTable,
  adminSettingsTable,
  usersTable,
  venuesTable,
  pitchesTable,
  bookingsTable,
} from "@workspace/db/schema";
import { eq, and } from "drizzle-orm";
import { randomUUID } from "crypto";
import type { PricingQuote } from "./growth-tools";

/** Never commit a resumable payment without the exact incentive/fee snapshot. */
async function persistCheckoutPayment(values: typeof paymentsTable.$inferInsert, quote?: PricingQuote) {
  await db.transaction(async (tx) => {
    const [booking] = await tx.select().from(bookingsTable)
      .where(eq(bookingsTable.id, values.bookingId)).for("update");
    await tx.insert(paymentsTable).values(values);
    if (!quote) return;
    if (!booking || booking.status !== "PENDING" || booking.checkoutKey !== values.idempotencyKey) {
      throw new Error("Booking checkout changed before pricing could be persisted");
    }
    if (booking.pricingSnapshot) {
      const snapshot = booking.pricingSnapshot;
      if (snapshot.payableAmount !== quote.payableAmount || snapshot.incentiveId !== quote.incentiveId ||
          snapshot.feeAmount !== values.feeAmount || snapshot.feePercent !== values.feePercent ||
          snapshot.feeWaived !== values.feeWaived) throw new Error("Payment differs from immutable booking pricing");
      return;
    }
    await tx.update(bookingsTable).set({ pricingSnapshot: {
      ...quote, feeAmount: values.feeAmount!, feePercent: values.feePercent!,
      feeWaived: values.feeWaived!, capturedAt: new Date().toISOString(),
    }}).where(and(eq(bookingsTable.id, values.bookingId), eq(bookingsTable.status, "PENDING")));
  });
}

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface PaymentIntentResult {
  providerPaymentId: string;
  amount: string;
  feeAmount: string;
  feePercent: string;
  feeWaived: boolean;
  currency: string;
  /** Present only for Stripe mode — client must present payment sheet with this secret. */
  clientSecret?: string;
}

export interface PaymentProvider {
  createPaymentIntent(opts: {
    bookingId: string;
    venueId: string;
    subtotalAmount: string;
    paymentType: "FULL" | "DEPOSIT";
    idempotencyKey: string;
    /** Pre-computed deposit amount from venue pricing rules. Required when paymentType=DEPOSIT. */
    depositAmountOverride?: string;
    feePercentOverride?: string;
    feeWaivedOverride?: boolean;
    bookingQuote?: PricingQuote;
  }): Promise<PaymentIntentResult>;

  confirmPayment(providerPaymentId: string): Promise<{ success: boolean; terminal?: boolean; errorMessage?: string }>;
  getClientSecret(providerPaymentId: string): Promise<string | undefined>;
  /** True only after the provider guarantees this intent cannot subsequently charge. */
  cancelUnpaidIntent(providerPaymentId: string): Promise<boolean>;

  refundPayment(opts: {
    providerPaymentId: string;
    amount: string;
    reason?: string;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; refundId: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getEffectiveFeePercent(venueId: string): Promise<{ feePercent: string; feeWaived: boolean }> {
  const [settings] = await db
    .select()
    .from(adminSettingsTable)
    .limit(1);

  if (!settings || !settings.feeEnabled) {
    return { feePercent: "0.00", feeWaived: true };
  }

  // Check per-venue override
  const overrides = (settings.perVenueOverrides ?? {}) as Record<string, boolean>;
  if (Object.prototype.hasOwnProperty.call(overrides, venueId)) {
    const venueEnabled = overrides[venueId];
    if (!venueEnabled) {
      return { feePercent: "0.00", feeWaived: true };
    }
  }

  return { feePercent: settings.feePercent, feeWaived: false };
}

// Computes the EUR fee amount charged for a given base amount, as a percentage of that amount.
function computeFeeAmount(baseAmount: string, feePercent: string): string {
  const fee = parseFloat(baseAmount) * (parseFloat(feePercent) / 100);
  return fee.toFixed(2);
}

function computeDepositAmount(subtotal: string): string {
  // Deposit = 30% of subtotal, minimum €1
  const amount = Math.max(1, parseFloat(subtotal) * 0.3);
  return amount.toFixed(2);
}

/** Fetch the owner's Stripe Connect account ID for a given venue. Returns null if not found. */
async function getOwnerStripeAccountId(venueId: string): Promise<string | null> {
  const [row] = await db
    .select({ stripeConnectAccountId: usersTable.stripeConnectAccountId })
    .from(venuesTable)
    .innerJoin(usersTable, eq(venuesTable.ownerId, usersTable.id))
    .where(eq(venuesTable.id, venueId))
    .limit(1);
  return row?.stripeConnectAccountId ?? null;
}

// ─── MockPaymentProvider ──────────────────────────────────────────────────────
// Mirrors the Stripe state machine interface so Stripe can be swapped in later.
// Always succeeds in demo mode.

export class MockPaymentProvider implements PaymentProvider {
  async createPaymentIntent(opts: {
    bookingId: string;
    venueId: string;
    subtotalAmount: string;
    paymentType: "FULL" | "DEPOSIT";
    idempotencyKey: string;
    depositAmountOverride?: string;
    feePercentOverride?: string;
    feeWaivedOverride?: boolean;
    bookingQuote?: PricingQuote;
  }): Promise<PaymentIntentResult> {
    const { bookingId, venueId, subtotalAmount, paymentType, idempotencyKey, depositAmountOverride } = opts;

    const currentFee = await getEffectiveFeePercent(venueId);
    const feePercent = opts.feePercentOverride ?? currentFee.feePercent;
    const feeWaived = opts.feeWaivedOverride ?? currentFee.feeWaived;

    const baseAmount =
      paymentType === "DEPOSIT"
        ? (depositAmountOverride ?? computeDepositAmount(subtotalAmount))
        : subtotalAmount;

    const appliedFeePercent = feeWaived ? "0.00" : feePercent;
    const feeAmount = feeWaived ? "0.00" : computeFeeAmount(baseAmount, feePercent);

    const totalAmount = feeWaived
      ? baseAmount
      : (parseFloat(baseAmount) + parseFloat(feeAmount)).toFixed(2);

    const providerPaymentId = `mock_pi_${randomUUID().replace(/-/g, "").slice(0, 20)}`;

    await persistCheckoutPayment({
      bookingId,
      provider: "MOCK",
      providerPaymentId,
      amount: totalAmount,
      currency: "EUR",
      feeAmount,
      feePercent: appliedFeePercent,
      feeWaived,
      status: "PENDING",
      paymentType,
      idempotencyKey,
    }, opts.bookingQuote);

    return { providerPaymentId, amount: totalAmount, feeAmount, feePercent: appliedFeePercent, feeWaived, currency: "EUR" };
  }

  async confirmPayment(providerPaymentId: string): Promise<{ success: boolean; terminal?: boolean; errorMessage?: string }> {
    // Deterministic failure mode: set MOCK_PAYMENT_FAIL=true to simulate declines.
    // This allows testing the payment failure UX path without real payment infrastructure.
    // NOTE: This method only checks for success/failure and does NOT update the DB.
    // The caller (checkout route) is responsible for updating payment + booking atomically.
    if (process.env.MOCK_PAYMENT_FAIL === "true") {
      return { success: false, terminal: true, errorMessage: "Payment declined (simulated failure mode)" };
    }

    // Normal path — always succeeds in demo mode
    return { success: true };
  }

  async getClientSecret(_providerPaymentId: string): Promise<string | undefined> {
    return undefined;
  }

  async cancelUnpaidIntent(_providerPaymentId: string): Promise<boolean> {
    return true;
  }

  async refundPayment(opts: {
    providerPaymentId: string;
    amount: string;
    reason?: string;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; refundId: string }> {
    // NOTE: intentionally does NOT write to DB here.
    // Callers are responsible for updating payment.status inside their own transaction
    // so that the refund is atomic with booking/refund-record/audit writes.
    return { success: true, refundId: `mock_re_${randomUUID().replace(/-/g, "").slice(0, 20)}` };
  }
}

// ─── StripePaymentProvider ────────────────────────────────────────────────────
// Real Stripe integration. Requires STRIPE_TEST_SK env var.

export class StripePaymentProvider implements PaymentProvider {
  private stripe: ReturnType<typeof this.buildStripe>;

  constructor(secretKey: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Stripe = require("stripe");
    this.stripe = new Stripe(secretKey, { apiVersion: "2024-11-20.acacia" });
  }

  private buildStripe(_key: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Stripe = require("stripe");
    return new Stripe(_key, { apiVersion: "2024-11-20.acacia" });
  }

  async createPaymentIntent(opts: {
    bookingId: string;
    venueId: string;
    subtotalAmount: string;
    paymentType: "FULL" | "DEPOSIT";
    idempotencyKey: string;
    depositAmountOverride?: string;
    feePercentOverride?: string;
    feeWaivedOverride?: boolean;
    bookingQuote?: PricingQuote;
  }): Promise<PaymentIntentResult> {
    const { bookingId, venueId, subtotalAmount, paymentType, idempotencyKey, depositAmountOverride } = opts;

    const currentFee = await getEffectiveFeePercent(venueId);
    const feePercent = opts.feePercentOverride ?? currentFee.feePercent;
    const feeWaived = opts.feeWaivedOverride ?? currentFee.feeWaived;

    const baseAmount =
      paymentType === "DEPOSIT"
        ? (depositAmountOverride ?? computeDepositAmount(subtotalAmount))
        : subtotalAmount;

    const appliedFeePercent = feeWaived ? "0.00" : feePercent;
    const feeAmount = feeWaived ? "0.00" : computeFeeAmount(baseAmount, feePercent);

    const totalAmount = feeWaived
      ? baseAmount
      : (parseFloat(baseAmount) + parseFloat(feeAmount)).toFixed(2);

    // Stripe amounts are in smallest currency unit (cents for EUR)
    const amountCents = Math.round(parseFloat(totalAmount) * 100);
    const feeCents = Math.round(parseFloat(feeAmount) * 100);

    // Look up the venue owner's Stripe Connect account for destination transfer
    const ownerStripeAccountId = await getOwnerStripeAccountId(venueId);

    // Build PaymentIntent params
    const piParams: Record<string, unknown> = {
      amount: amountCents,
      currency: "eur",
      metadata: {
        bookingId,
        venueId,
        paymentType,
        feePercent: appliedFeePercent,
      },
      // Required for mobile payment sheet
      automatic_payment_methods: { enabled: true },
    };

    // Apply platform fee + transfer to owner only if they have a connected account
    if (ownerStripeAccountId && !feeWaived) {
      piParams.application_fee_amount = feeCents;
      piParams.transfer_data = { destination: ownerStripeAccountId };
    } else if (ownerStripeAccountId && feeWaived) {
      // Fee waived — still transfer full amount to owner
      piParams.transfer_data = { destination: ownerStripeAccountId };
    }

    let pi: Awaited<ReturnType<typeof this.stripe.paymentIntents.create>>;
    try {
      pi = await this.stripe.paymentIntents.create(piParams, {
        idempotencyKey,
      });
    } catch (err: unknown) {
      const stripeErr = err as { type?: string; message?: string; statusCode?: number };
      if (stripeErr.statusCode === 401 || stripeErr.type === "StripeAuthenticationError") {
        throw Object.assign(
          new Error("Stripe API key is invalid. Please check STRIPE_TEST_SK in your environment secrets."),
          { isStripeAuthError: true },
        );
      }
      throw err;
    }

    await persistCheckoutPayment({
      bookingId,
      provider: "STRIPE",
      providerPaymentId: pi.id,
      amount: totalAmount,
      currency: "EUR",
      feeAmount,
      feePercent: appliedFeePercent,
      feeWaived,
      status: "PENDING",
      paymentType,
      idempotencyKey,
      metadata: { stripePaymentIntentId: pi.id },
    }, opts.bookingQuote);

    return {
      providerPaymentId: pi.id,
      amount: totalAmount,
      feeAmount,
      feePercent: appliedFeePercent,
      feeWaived,
      currency: "EUR",
      clientSecret: pi.client_secret ?? undefined,
    };
  }

  async confirmPayment(providerPaymentId: string): Promise<{ success: boolean; terminal?: boolean; errorMessage?: string }> {
    try {
      const pi = await this.stripe.paymentIntents.retrieve(providerPaymentId);

      if (pi.status === "succeeded") {
        return { success: true };
      }

      if (pi.status === "canceled") {
        return { success: false, terminal: true, errorMessage: "Payment was canceled. Please create a new booking." };
      }

      // Other statuses: requires_action, processing, requires_capture — not yet succeeded
      return { success: false, errorMessage: `Payment pending (status: ${pi.status})` };
    } catch (err: unknown) {
      return { success: false, errorMessage: "Payment status is temporarily unavailable. Please retry." };
    }
  }

  async getClientSecret(providerPaymentId: string): Promise<string | undefined> {
    const intent = await this.stripe.paymentIntents.retrieve(providerPaymentId);
    if (intent.status === "canceled") throw new Error("PaymentIntent was canceled");
    return intent.client_secret ?? undefined;
  }

  async cancelUnpaidIntent(providerPaymentId: string): Promise<boolean> {
    const intent = await this.stripe.paymentIntents.retrieve(providerPaymentId);
    if (intent.status === "canceled") return true;
    // Never release a reservation while an intent is processing or succeeded.
    if (!["requires_payment_method", "requires_confirmation", "requires_action"].includes(intent.status)) return false;
    const canceled = await this.stripe.paymentIntents.cancel(providerPaymentId);
    return canceled.status === "canceled";
  }

  async refundPayment(opts: {
    providerPaymentId: string;
    amount: string;
    reason?: string;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; refundId: string }> {
    const amountCents = Math.round(parseFloat(opts.amount) * 100);

    const refund = await this.stripe.refunds.create(
      {
        payment_intent: opts.providerPaymentId,
        amount: amountCents,
        reason: (opts.reason as "duplicate" | "fraudulent" | "requested_by_customer") ?? "requested_by_customer",
      },
      opts.idempotencyKey ? { idempotencyKey: opts.idempotencyKey } : undefined,
    );

    return { success: refund.status === "succeeded" || refund.status === "pending", refundId: refund.id };
  }
}

// ─── Provider Factory ─────────────────────────────────────────────────────────
// Instantiate StripePaymentProvider when STRIPE_TEST_SK is present, else MockPaymentProvider.

function createPaymentProvider(): PaymentProvider {
  const stripeKey = process.env.STRIPE_TEST_SK;
  if (stripeKey) {
    console.info("[payment-provider] Using StripePaymentProvider (STRIPE_TEST_SK is set)");
    return new StripePaymentProvider(stripeKey);
  }
  console.info("[payment-provider] Using MockPaymentProvider (STRIPE_TEST_SK not set)");
  return new MockPaymentProvider();
}

export const paymentProvider: PaymentProvider = createPaymentProvider();

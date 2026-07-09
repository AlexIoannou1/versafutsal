import { db } from "@workspace/db";
import {
  paymentsTable,
  adminSettingsTable,
} from "@workspace/db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";

// ─── Interfaces ───────────────────────────────────────────────────────────────

export interface PaymentIntentResult {
  providerPaymentId: string;
  amount: string;
  feeAmount: string;
  feePercent: string;
  feeWaived: boolean;
  currency: string;
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
  }): Promise<PaymentIntentResult>;

  confirmPayment(providerPaymentId: string): Promise<{ success: boolean; errorMessage?: string }>;

  refundPayment(opts: {
    providerPaymentId: string;
    amount: string;
    reason?: string;
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
  }): Promise<PaymentIntentResult> {
    const { bookingId, venueId, subtotalAmount, paymentType, idempotencyKey, depositAmountOverride } = opts;

    const { feePercent, feeWaived } = await getEffectiveFeePercent(venueId);

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

    await db.insert(paymentsTable).values({
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
    });

    return { providerPaymentId, amount: totalAmount, feeAmount, feePercent: appliedFeePercent, feeWaived, currency: "EUR" };
  }

  async confirmPayment(providerPaymentId: string): Promise<{ success: boolean; errorMessage?: string }> {
    // Deterministic failure mode: set MOCK_PAYMENT_FAIL=true to simulate declines.
    // This allows testing the payment failure UX path without real payment infrastructure.
    // NOTE: This method only checks for success/failure and does NOT update the DB.
    // The caller (checkout route) is responsible for updating payment + booking atomically.
    if (process.env.MOCK_PAYMENT_FAIL === "true") {
      return { success: false, errorMessage: "Payment declined (simulated failure mode)" };
    }

    // Normal path — always succeeds in demo mode
    return { success: true };
  }

  async refundPayment(opts: {
    providerPaymentId: string;
    amount: string;
    reason?: string;
  }): Promise<{ success: boolean; refundId: string }> {
    // NOTE: intentionally does NOT write to DB here.
    // Callers are responsible for updating payment.status inside their own transaction
    // so that the refund is atomic with booking/refund-record/audit writes.
    return { success: true, refundId: `mock_re_${randomUUID().replace(/-/g, "").slice(0, 20)}` };
  }
}

export const paymentProvider: PaymentProvider = new MockPaymentProvider();

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
  }): Promise<PaymentIntentResult>;

  confirmPayment(providerPaymentId: string): Promise<{ success: boolean; errorMessage?: string }>;

  refundPayment(opts: {
    providerPaymentId: string;
    amount: string;
    reason?: string;
  }): Promise<{ success: boolean; refundId: string }>;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getEffectiveFee(venueId: string): Promise<{ feeAmount: string; feeWaived: boolean }> {
  const [settings] = await db
    .select()
    .from(adminSettingsTable)
    .limit(1);

  if (!settings || !settings.feeEnabled) {
    return { feeAmount: "0.00", feeWaived: true };
  }

  // Check per-venue override
  const overrides = (settings.perVenueOverrides ?? {}) as Record<string, boolean>;
  if (Object.prototype.hasOwnProperty.call(overrides, venueId)) {
    const venueEnabled = overrides[venueId];
    if (!venueEnabled) {
      return { feeAmount: "0.00", feeWaived: true };
    }
  }

  return { feeAmount: settings.feeAmount, feeWaived: false };
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
  }): Promise<PaymentIntentResult> {
    const { bookingId, venueId, subtotalAmount, paymentType, idempotencyKey } = opts;

    const { feeAmount, feeWaived } = await getEffectiveFee(venueId);

    const baseAmount =
      paymentType === "DEPOSIT"
        ? computeDepositAmount(subtotalAmount)
        : subtotalAmount;

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
      feeWaived,
      status: "PENDING",
      paymentType,
      idempotencyKey,
    });

    return { providerPaymentId, amount: totalAmount, feeAmount, feeWaived, currency: "EUR" };
  }

  async confirmPayment(providerPaymentId: string): Promise<{ success: boolean; errorMessage?: string }> {
    // MockPaymentProvider always succeeds
    await db
      .update(paymentsTable)
      .set({ status: "SUCCEEDED", updatedAt: new Date() })
      .where(eq(paymentsTable.providerPaymentId, providerPaymentId));

    return { success: true };
  }

  async refundPayment(opts: {
    providerPaymentId: string;
    amount: string;
    reason?: string;
  }): Promise<{ success: boolean; refundId: string }> {
    await db
      .update(paymentsTable)
      .set({ status: "REFUNDED", updatedAt: new Date() })
      .where(eq(paymentsTable.providerPaymentId, opts.providerPaymentId));

    return { success: true, refundId: `mock_re_${randomUUID().replace(/-/g, "").slice(0, 20)}` };
  }
}

export const paymentProvider: PaymentProvider = new MockPaymentProvider();

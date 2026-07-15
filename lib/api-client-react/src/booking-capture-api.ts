import { customFetch } from "./custom-fetch";

export interface CheckoutResponse {
  requiresClientAction?: boolean;
  clientSecret?: string;
  publishableKey?: string;
  alreadyProcessed?: boolean;
  booking: {
    id: string;
    status: string;
    startAt?: string;
    endAt?: string;
  };
  payment?: {
    id: string | null;
    amount: string;
    feeAmount: string;
    feePercent: string;
    feeWaived: boolean;
    paymentType: string;
    currency: string;
    status: string;
    provider: string;
    createdAt?: string;
    updatedAt?: string;
  } | null;
}

export interface CaptureResponse {
  booking: { id: string; status: string };
  payment?: {
    id: string;
    amount: string;
    feeAmount: string;
    feePercent: string;
    feeWaived: boolean;
    paymentType: string;
    currency: string;
    status: string;
    provider: string;
    createdAt: string;
    updatedAt: string;
  } | null;
}

/**
 * POST /api/bookings/:bookingId/capture
 * Called after the Stripe payment sheet confirms the PaymentIntent on-device.
 * Verifies payment status on Stripe's side and marks the booking CONFIRMED.
 */
export async function captureBookingPayment(bookingId: string): Promise<CaptureResponse> {
  return customFetch<CaptureResponse>(`/api/bookings/${bookingId}/capture`, {
    method: "POST",
  });
}

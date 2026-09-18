export type AnalyticsBooking = {
  customerId: string;
  startAt: Date;
  status: string;
};

export type AnalyticsPayment = {
  id: string;
  createdAt: Date;
  amount: number;
  feeAmount: number;
  status: string;
  refundedAmount: number;
};

export type FinancialPayment = {
  bookingId?: string;
  amount: number;
  feeAmount: number;
  status: string;
  refundedAmount: number;
};

/**
 * Reports money actually collected for bookings. Only successful payment records
 * count; deposits naturally count as their persisted amount, and successful
 * refunds reduce gross revenue. Fee amounts are deliberately not adjusted here.
 */
export function computeCollectedRevenue(payments: FinancialPayment[]) {
  const revenueByBooking = new Map<string, number>();
  let totalRevenue = 0;
  let platformFees = 0;
  for (const payment of payments) {
    if (payment.status !== "SUCCEEDED" && payment.status !== "PARTIALLY_REFUNDED") continue;
    const collected = payment.amount - payment.refundedAmount;
    totalRevenue += collected;
    platformFees += payment.feeAmount;
    if (payment.bookingId) {
      revenueByBooking.set(
        payment.bookingId,
        (revenueByBooking.get(payment.bookingId) ?? 0) + collected,
      );
    }
  }
  return { totalRevenue, platformFees, netRevenue: totalRevenue - platformFees, revenueByBooking };
}

export type Metric<T> = {
  value: T | null;
  confidence: "insufficient" | "low" | "medium" | "high";
  explanation: string;
  definition: string;
  sampleSize: number;
};

const round = (value: number) => Math.round(value * 100) / 100;
const DAY = 86_400_000;

function activeCustomers(rows: AnalyticsBooking[], from: Date, to: Date): Set<string> {
  return new Set(
    rows
      .filter((row) =>
        row.startAt >= from &&
        row.startAt < to &&
        (row.status === "CONFIRMED" || row.status === "NO_SHOW"))
      .map((row) => row.customerId),
  );
}

export function computePremiumAnalytics(
  bookings: AnalyticsBooking[],
  payments: AnalyticsPayment[],
  now = new Date(),
) {
  const currentStart = new Date(now.getTime() - 30 * DAY);
  const previousStart = new Date(now.getTime() - 60 * DAY);
  const previousCustomers = activeCustomers(bookings, previousStart, currentStart);
  const currentCustomers = activeCustomers(bookings, currentStart, now);
  const retained = [...previousCustomers].filter((id) => currentCustomers.has(id)).length;
  const retention: Metric<number> = previousCustomers.size < 5
    ? {
        value: null,
        confidence: "insufficient",
        explanation: "At least 5 customers in the previous 30-day window are required.",
        definition: "Customers who booked in both of the last two 30-day windows divided by customers in the earlier window.",
        sampleSize: previousCustomers.size,
      }
    : {
        value: round((retained / previousCustomers.size) * 100),
        confidence: previousCustomers.size >= 30 ? "high" : previousCustomers.size >= 15 ? "medium" : "low",
        explanation: `${retained} of ${previousCustomers.size} prior-period customers returned.`,
        definition: "Customers who booked in both of the last two 30-day windows divided by customers in the earlier window.",
        sampleSize: previousCustomers.size,
      };

  const historicalActive = bookings.filter((row) =>
    row.startAt < now && (row.status === "CONFIRMED" || row.status === "NO_SHOW"));
  const counts = new Map<string, number>();
  for (const row of historicalActive) counts.set(row.customerId, (counts.get(row.customerId) ?? 0) + 1);
  const uniqueCustomers = counts.size;
  const repeatCount = [...counts.values()].filter((count) => count >= 2).length;
  const repeatCustomers: Metric<number> = uniqueCustomers < 5
    ? {
        value: null,
        confidence: "insufficient",
        explanation: "At least 5 customers with past bookings are required.",
        definition: "Customers with at least two past confirmed or no-show bookings as a percentage of all such customers.",
        sampleSize: uniqueCustomers,
      }
    : {
        value: round((repeatCount / uniqueCustomers) * 100),
        confidence: uniqueCustomers >= 30 ? "high" : uniqueCustomers >= 15 ? "medium" : "low",
        explanation: `${repeatCount} of ${uniqueCustomers} customers booked more than once.`,
        definition: "Customers with at least two past confirmed or no-show bookings as a percentage of all such customers.",
        sampleSize: uniqueCustomers,
      };

  const cancellationWindow = (from: Date, to: Date) =>
    bookings.filter((row) => row.startAt >= from && row.startAt < to);
  const previousBookings = cancellationWindow(previousStart, currentStart);
  const currentBookings = cancellationWindow(currentStart, now);
  const cancellationDefinition =
    "Percentage-point change in cancellation rate: latest 30 days minus the preceding 30 days; lower is better.";
  const enoughCancellationData = previousBookings.length >= 5 && currentBookings.length >= 5;
  const previousRate = previousBookings.length
    ? previousBookings.filter((row) => row.status === "CANCELLED" || row.status === "REFUNDED").length / previousBookings.length
    : 0;
  const currentRate = currentBookings.length
    ? currentBookings.filter((row) => row.status === "CANCELLED" || row.status === "REFUNDED").length / currentBookings.length
    : 0;
  const cancellationTrend: Metric<number> = enoughCancellationData
    ? {
        value: round((currentRate - previousRate) * 100),
        confidence: Math.min(previousBookings.length, currentBookings.length) >= 30 ? "high" : "low",
        explanation: `Cancellation rate changed from ${round(previousRate * 100)}% to ${round(currentRate * 100)}%.`,
        definition: cancellationDefinition,
        sampleSize: currentBookings.length + previousBookings.length,
      }
    : {
        value: null,
        confidence: "insufficient",
        explanation: "At least 5 bookings in each 30-day window are required.",
        definition: cancellationDefinition,
        sampleSize: currentBookings.length + previousBookings.length,
      };

  const revenueStart = new Date(now.getTime() - 90 * DAY);
  const eligiblePayments = payments.filter((payment) =>
    payment.createdAt >= revenueStart &&
    payment.createdAt < now &&
    (payment.status === "SUCCEEDED" || payment.status === "PARTIALLY_REFUNDED"));
  const netRevenue = computeCollectedRevenue(eligiblePayments).netRevenue;
  const revenueForecast: Metric<number> = eligiblePayments.length < 5
    ? {
        value: null,
        confidence: "insufficient",
        explanation: "At least 5 successful payments in the trailing 90 days are required.",
        definition: "Next-30-day net revenue forecast: trailing 90-day paid revenue, less stored fees and successful refunds, divided by 3.",
        sampleSize: eligiblePayments.length,
      }
    : {
        value: round(netRevenue / 3),
        confidence: eligiblePayments.length >= 30 ? "high" : eligiblePayments.length >= 15 ? "medium" : "low",
        explanation: `Based on ${eligiblePayments.length} successful payments in the trailing 90 days; this is a simple run-rate, not a guarantee.`,
        definition: "Next-30-day net revenue forecast: trailing 90-day paid revenue, less stored fees and successful refunds, divided by 3.",
        sampleSize: eligiblePayments.length,
      };

  return { retention, repeatCustomers, cancellationTrend, revenueForecast };
}
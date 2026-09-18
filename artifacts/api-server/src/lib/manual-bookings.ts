import type { BookingSource, BookingStatus } from "@workspace/db/schema";

export function canConfirmOfflinePayment(source: BookingSource, status: BookingStatus): boolean {
  return source === "MANUAL" && status === "PENDING";
}

export function canUsePaymentProvider(source: BookingSource): boolean {
  return source === "ONLINE";
}

export function recognizesBookingRevenue(
  source: BookingSource,
  status: BookingStatus,
  offlinePaymentReceivedAt: Date | null,
): boolean {
  if (status !== "CONFIRMED") return false;
  return source === "ONLINE" || offlinePaymentReceivedAt !== null;
}

export function bookingSnapshotRevenue(policySnapshot: unknown): number {
  const snapshot = policySnapshot as { pricePerHour?: string | number | null; slotDurationMinutes?: number } | null;
  return (parseFloat(String(snapshot?.pricePerHour ?? "0")) || 0) * ((snapshot?.slotDurationMinutes ?? 60) / 60);
}

export function bookingExportCsv(rows: Array<{
  id: string; startAt: Date; status: BookingStatus; source: BookingSource;
  offlinePaymentReceivedAt: Date | null; venueName: string; pitchName: string;
  policySnapshot: unknown; platformFee: number;
}>): string {
  const escape = (value: string | number) => `"${String(value).replaceAll('"', '""')}"`;
  const header = "bookingId,date,status,source,venue,pitch,recognizedRevenue,platformFee,netRevenue";
  const lines = rows.map((row) => {
    const recognized = recognizesBookingRevenue(row.source, row.status, row.offlinePaymentReceivedAt)
      ? bookingSnapshotRevenue(row.policySnapshot) : 0;
    const fee = row.source === "ONLINE" ? row.platformFee : 0;
    return [row.id, row.startAt.toISOString(), row.status, row.source, row.venueName, row.pitchName,
      recognized.toFixed(2), fee.toFixed(2), (recognized - fee).toFixed(2)].map(escape).join(",");
  });
  return [header, ...lines].join("\n");
}
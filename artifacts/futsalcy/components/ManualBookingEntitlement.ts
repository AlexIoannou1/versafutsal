import type { OwnerSubscription } from "@workspace/api-client-react";
import type { ShowAppDialog } from "@/context/AppDialogContext";

export function hasManualBookingEntitlement(subscription?: OwnerSubscription): boolean {
  return subscription?.capabilities.includes("MANUAL_BOOKING") === true;
}

export function isEntitlementRequired(error: unknown): boolean {
  const data = (error as { data?: { code?: string } | null })?.data;
  return data?.code === "ENTITLEMENT_REQUIRED";
}

export function showManualBookingUpgrade(showDialog: ShowAppDialog, onUpgrade: () => void): void {
  showDialog({
    tone: "upgrade",
    title: "Upgrade to Pro",
    message: "Manual Bookings for walk-ins, phone bookings and offline payments are available on Pro and Elite plans.",
    actions: [
      { label: "Not now", kind: "secondary" },
      { label: "View Pro plans", kind: "primary", onPress: onUpgrade },
    ],
  });
}
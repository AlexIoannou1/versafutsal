import { customFetch } from "./custom-fetch";

export interface SavedCard {
  id: string;
  brand: string;
  last4: string;
  expMonth: number;
  expYear: number;
}

export interface ListPaymentMethodsResponse {
  demoMode: boolean;
  paymentMethods: SavedCard[];
}

export async function getStripeConfig(): Promise<{ publishableKey: string | null; demoMode: boolean }> {
  return customFetch<{ publishableKey: string | null; demoMode: boolean }>(
    "/api/player/payment-methods/config",
    { method: "GET" },
  );
}

export async function deleteAccount(): Promise<{ ok: boolean }> {
  return customFetch<{ ok: boolean }>("/api/player/account", {
    method: "DELETE",
  });
}

export async function clearPushToken(): Promise<{ ok: boolean }> {
  return customFetch<{ ok: boolean }>("/api/auth/push-token", {
    method: "DELETE",
  });
}

export async function listPaymentMethods(): Promise<ListPaymentMethodsResponse> {
  return customFetch<ListPaymentMethodsResponse>("/api/player/payment-methods", {
    method: "GET",
  });
}

export async function createSetupIntent(): Promise<{ clientSecret: string }> {
  return customFetch<{ clientSecret: string }>("/api/player/payment-methods/setup-intent", {
    method: "POST",
  });
}

export async function removePaymentMethod(pmId: string): Promise<{ ok: boolean }> {
  return customFetch<{ ok: boolean }>(`/api/player/payment-methods/${pmId}`, {
    method: "DELETE",
  });
}

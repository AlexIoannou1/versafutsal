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

export async function removePaymentMethod(pmId: string): Promise<{ ok: boolean }> {
  return customFetch<{ ok: boolean }>(`/api/player/payment-methods/${pmId}`, {
    method: "DELETE",
  });
}

import { customFetch } from "./custom-fetch";

export interface OwnerConnectConfig {
  demoMode: boolean;
}

export interface OwnerConnectStatus {
  demoMode: boolean;
  connected: boolean;
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  displayName: string | null;
  payoutLast4: string | null;
}

export async function getOwnerConnectConfig(): Promise<OwnerConnectConfig> {
  return customFetch<OwnerConnectConfig>("/api/owner/connect/config", { method: "GET" });
}

export async function createOwnerConnectAccount(): Promise<{ accountId: string }> {
  return customFetch<{ accountId: string }>("/api/owner/connect/account", { method: "POST" });
}

export async function getOwnerConnectOnboardingLink(): Promise<{ url: string }> {
  return customFetch<{ url: string }>("/api/owner/connect/onboarding-link", { method: "POST" });
}

export async function getOwnerConnectStatus(): Promise<OwnerConnectStatus> {
  return customFetch<OwnerConnectStatus>("/api/owner/connect/status", { method: "GET" });
}

export async function disconnectOwnerConnectAccount(): Promise<{ ok: boolean }> {
  return customFetch<{ ok: boolean }>("/api/owner/connect/account", { method: "DELETE" });
}

export async function deleteOwnerAccount(): Promise<{ ok: boolean }> {
  return customFetch<{ ok: boolean }>("/api/owner/account", { method: "DELETE" });
}

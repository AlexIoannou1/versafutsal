import { normalizePhoneNumber as normalizeAccountPhone } from "@workspace/api-zod";

export type SmsSendResult =
  | { outcome: "sent"; provider: string; messageId: string | null }
  | { outcome: "disabled"; provider: "disabled" }
  | { outcome: "retryable"; provider: string; errorCode: string }
  | { outcome: "failed"; provider: string; errorCode: string };

export interface SmsProvider {
  readonly name: string;
  readonly enabled: boolean;
  send(input: { to: string; body: string; idempotencyKey: string }): Promise<SmsSendResult>;
}

export function normalizeSmsPhone(value: string): string {
  const normalized = normalizeAccountPhone(value);
  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw new Error("Phone number is not valid E.164");
  }
  return normalized;
}

export function createSmsProvider(env: NodeJS.ProcessEnv = process.env): SmsProvider {
  const endpoint = env.SMS_PROVIDER_URL?.trim();
  const token = env.SMS_PROVIDER_TOKEN?.trim();
  const from = env.SMS_PROVIDER_FROM?.trim();
  const providerName = env.SMS_PROVIDER_NAME?.trim() || "http";
  const timeoutMs = Math.min(15_000, Math.max(500, Number(env.SMS_TIMEOUT_MS) || 5_000));

  if (!endpoint || !token || !from) {
    return {
      name: "disabled",
      enabled: false,
      async send() {
        return { outcome: "disabled", provider: "disabled" };
      },
    };
  }

  return {
    name: providerName,
    enabled: true,
    async send(input) {
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "authorization": `Bearer ${token}`,
            "content-type": "application/json",
            "idempotency-key": input.idempotencyKey,
          },
          body: JSON.stringify({ from, to: input.to, body: input.body }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.ok) {
          const payload = await response.json().catch(() => ({})) as { id?: string; messageId?: string };
          return {
            outcome: "sent",
            provider: providerName,
            messageId: payload.messageId ?? payload.id ?? null,
          };
        }
        const errorCode = `HTTP_${response.status}`;
        return response.status === 408 || response.status === 429 || response.status >= 500
          ? { outcome: "retryable", provider: providerName, errorCode }
          : { outcome: "failed", provider: providerName, errorCode };
      } catch (error) {
        const errorCode = error instanceof DOMException && error.name === "TimeoutError"
          ? "TIMEOUT"
          : "NETWORK_ERROR";
        return { outcome: "retryable", provider: providerName, errorCode };
      }
    },
  };
}

export const smsProvider = createSmsProvider();
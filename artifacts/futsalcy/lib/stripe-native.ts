import React from "react";

export function StripeProvider({ children }: { children: React.ReactNode; publishableKey?: string }) {
  return children as React.ReactElement;
}

export function useStripe() {
  const unsupported = async () => ({
    error: { code: "WebUnsupported" as const, message: "Stripe native SDK is not available on web." },
  });
  return {
    initPaymentSheet: unsupported,
    presentPaymentSheet: unsupported,
    confirmSetupIntent: unsupported,
    createToken: unsupported,
  };
}

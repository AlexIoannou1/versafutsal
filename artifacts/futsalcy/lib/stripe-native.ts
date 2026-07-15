import React from "react";

export function StripeProvider({ children }: { children: React.ReactNode; publishableKey?: string }) {
  return children as React.ReactElement;
}

type UnsupportedError = { error: { code: string; message: string } };

const webUnsupported = async (..._args: unknown[]): Promise<UnsupportedError> => ({
  error: { code: "WebUnsupported", message: "Stripe native SDK is not available on web." },
});

export function useStripe() {
  return {
    initPaymentSheet: webUnsupported,
    presentPaymentSheet: webUnsupported,
    confirmSetupIntent: webUnsupported,
    createToken: webUnsupported,
  };
}

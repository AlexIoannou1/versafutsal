const React = require("react");

function StripeProvider({ children }) {
  return children;
}

function useStripe() {
  return {
    initPaymentSheet: async () => ({ error: { code: "WebUnsupported", message: "Stripe native SDK is not available on web." } }),
    presentPaymentSheet: async () => ({ error: { code: "WebUnsupported", message: "Stripe native SDK is not available on web." } }),
    confirmSetupIntent: async () => ({ error: { code: "WebUnsupported", message: "Stripe native SDK is not available on web." } }),
    createToken: async () => ({ error: { code: "WebUnsupported", message: "Stripe native SDK is not available on web." } }),
  };
}

module.exports = { StripeProvider, useStripe };

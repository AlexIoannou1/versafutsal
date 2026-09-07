export type StripeWebhookVerifier = {
  webhooks: {
    constructEvent(payload: Buffer, signature: string, secret: string): unknown;
  };
};

export function constructVerifiedSubscriptionEvent(
  stripe: StripeWebhookVerifier,
  rawBody: Buffer,
  signature: string,
  secret: string,
) {
  return stripe.webhooks.constructEvent(rawBody, signature, secret);
}
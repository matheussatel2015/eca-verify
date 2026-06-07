export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');

export interface CheckoutInput {
  tenantId: string;
  planId: string;
}
export interface CheckoutResult {
  url: string;
}
export interface SubscriptionChange {
  tenantId: string;
  planId: string;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
}

export interface PaymentPort {
  createCheckout(input: CheckoutInput): Promise<CheckoutResult>;
  /** Verify + parse a gateway webhook into a plan change, or null if irrelevant/invalid. */
  resolveWebhook(rawBody: Buffer, signature: string): Promise<SubscriptionChange | null>;
}

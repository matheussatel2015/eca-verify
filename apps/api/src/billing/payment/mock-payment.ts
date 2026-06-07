import { CheckoutInput, CheckoutResult, PaymentPort, SubscriptionChange } from './payment.port';

export class MockPaymentProvider implements PaymentPort {
  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    return { url: `https://checkout.mock/session?tenant=${input.tenantId}&plan=${input.planId}` };
  }
  async resolveWebhook(rawBody: Buffer, _signature: string): Promise<SubscriptionChange | null> {
    try {
      const o = JSON.parse(rawBody.toString('utf8'));
      if (typeof o?.tenantId === 'string' && typeof o?.planId === 'string') {
        return { tenantId: o.tenantId, planId: o.planId, stripeCustomerId: o.stripeCustomerId, stripeSubscriptionId: o.stripeSubscriptionId };
      }
      return null;
    } catch {
      return null;
    }
  }
}

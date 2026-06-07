import type Stripe from 'stripe';
import { CheckoutInput, CheckoutResult, PaymentPort, SubscriptionChange } from './payment.port';

export interface StripeAdapterConfig {
  webhookSecret: string;
  successUrl: string;
  cancelUrl: string;
  priceFor: (planId: string) => string;
}

export class StripeAdapter implements PaymentPort {
  constructor(private readonly stripe: Stripe, private readonly cfg: StripeAdapterConfig) {}

  async createCheckout(input: CheckoutInput): Promise<CheckoutResult> {
    const price = this.cfg.priceFor(input.planId);
    if (!price) throw new Error(`no Stripe price configured for plan '${input.planId}'`);
    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price, quantity: 1 }],
      success_url: this.cfg.successUrl,
      cancel_url: this.cfg.cancelUrl,
      client_reference_id: input.tenantId,
      metadata: { tenantId: input.tenantId, planId: input.planId },
    });
    return { url: session.url ?? '' };
  }

  async resolveWebhook(rawBody: Buffer, signature: string): Promise<SubscriptionChange | null> {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.cfg.webhookSecret);
    if (event.type === 'checkout.session.completed') {
      const s = event.data.object as Stripe.Checkout.Session;
      return {
        tenantId: s.client_reference_id ?? '',
        planId: (s.metadata?.planId as string) ?? '',
        stripeCustomerId: (s.customer as string) ?? undefined,
        stripeSubscriptionId: (s.subscription as string) ?? undefined,
      };
    }
    if (event.type === 'customer.subscription.deleted') {
      const sub = event.data.object as Stripe.Subscription;
      return { tenantId: (sub.metadata?.tenantId as string) ?? '', planId: 'free', stripeSubscriptionId: sub.id };
    }
    return null;
  }
}

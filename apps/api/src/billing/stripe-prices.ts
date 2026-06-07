export function stripePriceFor(planId: string, env: NodeJS.ProcessEnv): string {
  if (planId === 'pro') return env.STRIPE_PRICE_PRO ?? '';
  if (planId === 'scale') return env.STRIPE_PRICE_SCALE ?? '';
  return ''; // free or unknown — no subscription price
}

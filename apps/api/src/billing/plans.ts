export interface Plan {
  id: string;
  name: string;
  monthlyQuota: number;
  monthlyPriceCents: number;
}

export const PLANS: Record<string, Plan> = {
  free: { id: 'free', name: 'Free', monthlyQuota: 100, monthlyPriceCents: 0 },
  pro: { id: 'pro', name: 'Pro', monthlyQuota: 10000, monthlyPriceCents: 49900 },
  scale: { id: 'scale', name: 'Scale', monthlyQuota: 100000, monthlyPriceCents: 199900 },
};

export const DEFAULT_PLAN_ID = 'free';

export function getPlan(id: string | null | undefined): Plan {
  return PLANS[id ?? ''] ?? PLANS[DEFAULT_PLAN_ID];
}

export function isValidPlanId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(PLANS, id);
}

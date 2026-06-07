import { Plan } from './plans';

export interface Invoice {
  period: string;
  plan_id: string;
  plan_name: string;
  monthly_price_cents: number;
  quota: number;
  used: number;
  remaining: number;
  within_quota: boolean;
}

export function buildInvoice(plan: Plan, used: number, period: string): Invoice {
  return {
    period,
    plan_id: plan.id,
    plan_name: plan.name,
    monthly_price_cents: plan.monthlyPriceCents,
    quota: plan.monthlyQuota,
    used,
    remaining: Math.max(0, plan.monthlyQuota - used),
    within_quota: used <= plan.monthlyQuota,
  };
}

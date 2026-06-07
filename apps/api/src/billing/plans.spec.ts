import { getPlan, isValidPlanId, PLANS, DEFAULT_PLAN_ID } from './plans';

test('has free, pro and scale tiers', () => {
  expect(Object.keys(PLANS).sort()).toEqual(['free', 'pro', 'scale']);
});

test('getPlan returns the tier or falls back to the default', () => {
  expect(getPlan('pro').id).toBe('pro');
  expect(getPlan('nope').id).toBe(DEFAULT_PLAN_ID);
  expect(getPlan(null).id).toBe(DEFAULT_PLAN_ID);
});

test('isValidPlanId only accepts known plans', () => {
  expect(isValidPlanId('scale')).toBe(true);
  expect(isValidPlanId('enterprise')).toBe(false);
});

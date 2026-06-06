import { FORBIDDEN_PII_FIELDS } from '@eca/sdk-types';

export function assertNoPii(payload: Record<string, unknown>): void {
  const keys = Object.keys(payload).map((k) => k.toLowerCase());
  for (const forbidden of FORBIDDEN_PII_FIELDS) {
    if (keys.includes(forbidden)) {
      throw new Error(`PII field "${forbidden}" is not allowed; send only user_hash`);
    }
  }
}

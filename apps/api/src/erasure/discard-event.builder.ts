import { randomUUID } from 'crypto';

export const DISCARD_KINDS = ['frame', 'document'] as const;
export type DiscardKind = typeof DISCARD_KINDS[number];

export interface DiscardEventInput {
  transactionId: string;
  tenantId: string;
  what: DiscardKind;
  now: Date;
}

// Proof that the ephemeral media was physically deleted — metadata only.
export function buildDiscardEvent(input: DiscardEventInput) {
  if (!(DISCARD_KINDS as readonly string[]).includes(input.what)) {
    throw new Error(`what must be one of ${DISCARD_KINDS.join(', ')}`);
  }
  return {
    id: randomUUID(),
    transactionId: input.transactionId,
    tenantId: input.tenantId,
    what: input.what,
    discardedAt: input.now,
  };
}

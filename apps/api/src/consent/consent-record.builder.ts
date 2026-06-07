import { maskIp } from '../audit/ip-mask.util';

export interface ConsentRecordInput {
  id: string;
  tenantId: string;
  userHash: string;
  policyVersion: string;
  scope?: string;
  rawIp: string;
  now: Date;
}

// Metadata only — NEVER any biometric/image data.
export function buildConsentRecord(input: ConsentRecordInput) {
  return {
    id: input.id,
    tenantId: input.tenantId,
    userHash: input.userHash,
    policyVersion: input.policyVersion,
    scope: input.scope ?? 'age_verification',
    maskedIp: maskIp(input.rawIp),
    createdAt: input.now,
  };
}

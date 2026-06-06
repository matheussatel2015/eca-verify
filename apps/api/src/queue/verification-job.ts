export interface VerificationJob {
  transactionId: string;
  tenantId: string;
  frameRef: string;
  rawIp: string;
}

export const VERIFICATION_QUEUE_NAME = 'verification';

export function buildVerificationJob(args: VerificationJob): VerificationJob {
  return {
    transactionId: args.transactionId,
    tenantId: args.tenantId,
    frameRef: args.frameRef,
    rawIp: args.rawIp,
  };
}

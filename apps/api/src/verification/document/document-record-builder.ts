import { isOver18 } from '../decision';
import { classifyAgeBand } from '../age-band';
import { VerificationStatus } from '@eca/sdk-types';

export interface DocRecordInput {
  transactionId: string;
  tenantId: string;
  status: VerificationStatus;
  ageFromDoc: number | null;
  faceMatchScore: number;
  cutoffAge: number;
  provider: string;
  modelVersion: string;
  now: Date;
}

export function buildDocumentRecord(i: DocRecordInput) {
  const reason = i.status === 'aprovado'
    ? `documento: idade ${i.ageFromDoc} >= corte ${i.cutoffAge}, facematch ${i.faceMatchScore}`
    : `documento reprovado (idade ${i.ageFromDoc}, facematch ${i.faceMatchScore}, corte ${i.cutoffAge})`;
  return {
    id: i.transactionId,
    tenantId: i.tenantId,
    status: i.status,
    isOver18: isOver18(i.status),
    method: 'document',
    estimatedAge: i.ageFromDoc,
    livenessScore: null,
    cutoffAge: i.cutoffAge,
    margin: 0,
    livenessThreshold: 0,
    provider: i.provider,
    modelVersion: i.modelVersion,
    decisionReason: reason,
    ageBand: classifyAgeBand(i.ageFromDoc),
    createdAt: i.now,
  };
}

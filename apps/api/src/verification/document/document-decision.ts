import { VerificationStatus } from '@eca/sdk-types';

export interface DocumentResult {
  ageFromDoc: number | null;
  faceMatchScore: number;
  identical: boolean;
}

export function ageFromBirthDate(isoBirthDate: string, now: Date): number {
  const dob = new Date(isoBirthDate);
  let age = now.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < dob.getUTCDate())) age--;
  return age;
}

export function decideDocument(result: DocumentResult, cutoffAge: number): VerificationStatus {
  if (!result.identical) return 'reprovado';
  if (result.ageFromDoc === null || result.ageFromDoc < cutoffAge) return 'reprovado';
  return 'aprovado';
}

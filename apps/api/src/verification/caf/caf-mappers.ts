import { AgeProviderResult } from '@eca/sdk-types';
import { DocumentVerifyOutput } from '../document/document-verifier.port';

export interface CafService { name: string; status: string; data: any; }
export interface CafTransaction { status: string; services: CafService[]; }

function service(tx: CafTransaction, name: string): CafService {
  const s = tx.services?.find((x) => x.name === name);
  if (!s) throw new Error(`CAF transaction missing service: ${name}`);
  return s;
}

export function isTransactionComplete(tx: CafTransaction): boolean {
  if (!tx.services?.length) return false;
  return tx.services.every((s) => s.status === 'COMPLETED');
}

export function extractAgeLiveness(tx: CafTransaction, scoreScale: number): AgeProviderResult {
  const liveness = service(tx, 'face_liveness');
  const face = service(tx, 'face_details');
  return {
    livenessScore: Number(liveness.data?.info?.probability ?? 0) / scoreScale,
    // ageRangeLow is the conservative bound: harder to clear the cutoff, never over-approves.
    estimatedAge: Number(face.data?.ageRangeLow ?? 0),
  };
}

export function extractDocument(tx: CafTransaction, scoreScale: number): DocumentVerifyOutput {
  const ocr = service(tx, 'ocr');
  const facematch = service(tx, 'facematch');
  return {
    birthDate: ocr.data?.ocr?.birthDate ?? null,
    faceMatchScore: Number(facematch.data?.confidence ?? 0) / scoreScale,
    identical: Boolean(facematch.data?.identical),
  };
}

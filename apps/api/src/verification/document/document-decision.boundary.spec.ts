import { decideDocument, DocumentResult } from './document-decision';

// decideDocument(result, cutoffAge, minFaceMatch = 0.8)
const CUTOFF = 18;

function doc(ageFromDoc: number | null, faceMatchScore: number, identical: boolean): DocumentResult {
  return { ageFromDoc, faceMatchScore, identical };
}

describe('decideDocument boundaries', () => {
  test('faceMatchScore exactly at default min (0.8), identical, age 20 -> aprovado', () => {
    expect(decideDocument(doc(20, 0.8, true), CUTOFF)).toBe('aprovado');
  });

  test('ageFromDoc exactly at cutoff (18) -> aprovado (rule: reprovado only when < cutoff)', () => {
    expect(decideDocument(doc(18, 0.8, true), CUTOFF)).toBe('aprovado');
  });

  test('ageFromDoc 17 (below cutoff) -> reprovado', () => {
    expect(decideDocument(doc(17, 0.8, true), CUTOFF)).toBe('reprovado');
  });
});

export const DOC_VERIFIER = Symbol('DOC_VERIFIER');

export interface DocumentVerifyInput {
  documentImage: Buffer;
  selfieImage: Buffer;
}

export interface DocumentVerifyOutput {
  birthDate: string | null;
  faceMatchScore: number;
  identical: boolean;
}

export interface DocumentVerifierPort {
  verify(input: DocumentVerifyInput): Promise<DocumentVerifyOutput>;
}

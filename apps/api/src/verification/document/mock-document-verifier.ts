import { DocumentVerifierPort, DocumentVerifyInput, DocumentVerifyOutput } from './document-verifier.port';

export class MockDocumentVerifier implements DocumentVerifierPort {
  constructor(private readonly fixed: DocumentVerifyOutput) {}
  async verify(_input: DocumentVerifyInput): Promise<DocumentVerifyOutput> {
    return { ...this.fixed };
  }
}

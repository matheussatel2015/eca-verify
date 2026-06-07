import { DocumentVerifierPort, DocumentVerifyInput, DocumentVerifyOutput } from '../document/document-verifier.port';
import { CafClient } from './caf-client';
import { extractDocument } from './caf-mappers';

export class CafDocumentVerifier implements DocumentVerifierPort {
  constructor(private readonly client: CafClient, private readonly scoreScale: number) {}

  async verify(input: DocumentVerifyInput): Promise<DocumentVerifyOutput> {
    const { id } = await this.client.createTransaction({
      services: ['ocr', 'facematch'],
      documentImage: input.documentImage.toString('base64'),
      selfieImage: input.selfieImage.toString('base64'),
    });
    const tx = await this.client.awaitTransaction(id);
    return extractDocument(tx, this.scoreScale);
  }
}

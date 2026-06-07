import { AgeProviderResult } from '@eca/sdk-types';
import { AgeProviderPort } from '../age-provider.port';
import { CafClient } from './caf-client';
import { extractAgeLiveness } from './caf-mappers';

export class CafAgeProvider implements AgeProviderPort {
  constructor(private readonly client: CafClient, private readonly scoreScale: number) {}

  async analyze(frame: Buffer): Promise<AgeProviderResult> {
    // Assumed transport: base64 image inside the transaction JSON (confirm in sandbox).
    const { id } = await this.client.createTransaction({
      services: ['face_liveness', 'face_details'],
      image: frame.toString('base64'),
    });
    const tx = await this.client.awaitTransaction(id);
    return extractAgeLiveness(tx, this.scoreScale);
  }
}

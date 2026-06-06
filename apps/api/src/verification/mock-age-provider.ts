import { AgeProviderResult } from '@eca/sdk-types';
import { AgeProviderPort } from './age-provider.port';

export class MockAgeProvider implements AgeProviderPort {
  constructor(private readonly fixed: AgeProviderResult) {}
  async analyze(_frame: Buffer): Promise<AgeProviderResult> {
    return { ...this.fixed };
  }
}

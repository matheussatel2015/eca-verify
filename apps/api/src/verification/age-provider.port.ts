import { AgeProviderResult } from '@eca/sdk-types';

export const AGE_PROVIDER = Symbol('AGE_PROVIDER');

export interface AgeProviderPort {
  analyze(frame: Buffer): Promise<AgeProviderResult>;
}

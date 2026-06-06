import { ProviderConfig } from '../config';
import { AgeProviderPort } from './age-provider.port';
import { MockAgeProvider } from './mock-age-provider';
import { CafClient } from './caf/caf-client';
import { CafAgeProvider } from './caf/caf-age-provider';

export function buildAgeProvider(cfg: ProviderConfig): AgeProviderPort {
  if (cfg.ageKind === 'mock') {
    return new MockAgeProvider({ estimatedAge: 30, livenessScore: 0.95 });
  }
  if (!cfg.caf) throw new Error('CAF config missing for ageKind=caf');
  return new CafAgeProvider(new CafClient(cfg.caf), cfg.caf.scoreScale);
}

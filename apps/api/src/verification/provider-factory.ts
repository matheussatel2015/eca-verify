import { ProviderConfig } from '../config';
import { AgeProviderPort } from './age-provider.port';
import { MockAgeProvider } from './mock-age-provider';
import { CafClient } from './caf/caf-client';
import { CafAgeProvider } from './caf/caf-age-provider';
import { DocumentVerifierPort } from './document/document-verifier.port';
import { MockDocumentVerifier } from './document/mock-document-verifier';
import { CafDocumentVerifier } from './caf/caf-document-verifier';

export function buildAgeProvider(cfg: ProviderConfig, client?: CafClient): AgeProviderPort {
  if (cfg.ageKind === 'mock') {
    return new MockAgeProvider({ estimatedAge: 30, livenessScore: 0.95 });
  }
  if (!cfg.caf) throw new Error('CAF config missing for ageKind=caf');
  return new CafAgeProvider(client ?? new CafClient(cfg.caf), cfg.caf.scoreScale);
}

export function buildDocumentVerifier(cfg: ProviderConfig, client?: CafClient): DocumentVerifierPort {
  if (cfg.docKind === 'mock') {
    return new MockDocumentVerifier({ birthDate: '1990-01-01', faceMatchScore: 0.99, identical: true });
  }
  if (!cfg.caf) throw new Error('CAF config missing for docKind=caf');
  return new CafDocumentVerifier(client ?? new CafClient(cfg.caf), cfg.caf.scoreScale);
}

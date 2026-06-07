import { buildAgeProvider, buildDocumentVerifier } from './provider-factory';
import { MockAgeProvider } from './mock-age-provider';
import { CafAgeProvider } from './caf/caf-age-provider';
import { MockDocumentVerifier } from './document/mock-document-verifier';

test('returns the mock provider when ageKind is mock', () => {
  const p = buildAgeProvider({ ageKind: 'mock', docKind: 'mock' });
  expect(p).toBeInstanceOf(MockAgeProvider);
});

test('returns the CAF provider when ageKind is caf', () => {
  const p = buildAgeProvider({
    ageKind: 'caf', docKind: 'mock',
    caf: { baseUrl: 'https://caf.test', clientId: 'i', clientSecret: 's', scoreScale: 100, timeoutMs: 1000, pollIntervalMs: 0, pollMaxAttempts: 3 },
  });
  expect(p).toBeInstanceOf(CafAgeProvider);
});

test('throws if caf is selected without config', () => {
  expect(() => buildAgeProvider({ ageKind: 'caf', docKind: 'mock' })).toThrow(/caf config/i);
});

test('returns the mock document verifier by default', () => {
  expect(buildDocumentVerifier({ ageKind: 'mock', docKind: 'mock' })).toBeInstanceOf(MockDocumentVerifier);
});

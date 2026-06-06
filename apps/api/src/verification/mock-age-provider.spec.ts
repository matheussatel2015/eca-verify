import { MockAgeProvider } from './mock-age-provider';

test('mock returns the configured result', async () => {
  const provider = new MockAgeProvider({ estimatedAge: 22, livenessScore: 0.95 });
  const result = await provider.analyze(Buffer.from('fake-frame'));
  expect(result).toEqual({ estimatedAge: 22, livenessScore: 0.95 });
});

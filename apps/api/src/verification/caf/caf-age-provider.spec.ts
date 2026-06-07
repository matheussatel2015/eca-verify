import { CafAgeProvider } from './caf-age-provider';

test('creates a transaction with the frame and maps the completed result', async () => {
  const client = {
    createTransaction: jest.fn(async (_payload: unknown) => ({ id: 'tx1' })),
    awaitTransaction: jest.fn(async () => ({
      status: 'COMPLETED',
      services: [
        { name: 'face_liveness', status: 'COMPLETED', data: { info: { probability: 88 } } },
        { name: 'face_details', status: 'COMPLETED', data: { ageRangeLow: 24, ageRangeHigh: 28 } },
      ],
    })),
  };
  const provider = new CafAgeProvider(client as any, 100);
  const result = await provider.analyze(Buffer.from('frame-bytes'));
  expect(result.estimatedAge).toBe(24);
  expect(result.livenessScore).toBeCloseTo(0.88);
  // the frame went out base64-encoded in the requested services
  const payload = client.createTransaction.mock.calls[0][0];
  expect(JSON.stringify(payload)).toContain(Buffer.from('frame-bytes').toString('base64'));
});

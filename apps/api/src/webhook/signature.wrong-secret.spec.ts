import { signPayload, verifySignature } from './signature.util';

describe('verifySignature with wrong secret', () => {
  test('signature made with one secret fails verification under another secret', () => {
    const body = '{"transaction_id":"tx_1","status":"aprovado"}';
    const signature = signPayload(body, 's1');
    expect(verifySignature(body, signature, 's2')).toBe(false);
  });

  test('sanity: correct secret still verifies true', () => {
    const body = '{"transaction_id":"tx_1","status":"aprovado"}';
    const signature = signPayload(body, 's1');
    expect(verifySignature(body, signature, 's1')).toBe(true);
  });
});

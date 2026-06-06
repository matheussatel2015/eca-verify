import { signPayload, verifySignature } from './signature.util';

const secret = 'tenant-webhook-secret';
const body = JSON.stringify({ transaction_id: '1', status: 'aprovado', is_over_18: true });

test('signature verifies against the same body and secret', () => {
  const sig = signPayload(body, secret);
  expect(verifySignature(body, sig, secret)).toBe(true);
});

test('signature fails when the body changes', () => {
  const sig = signPayload(body, secret);
  expect(verifySignature(body + 'x', sig, secret)).toBe(false);
});

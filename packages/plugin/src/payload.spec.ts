import { buildVerifyPayload } from './payload';

test('packs the encrypted frame as base64 with the session token', () => {
  const payload = buildVerifyPayload('sess-token', {
    iv: Buffer.from([1, 2, 3]),
    tag: Buffer.from([4, 5, 6]),
    ciphertext: Buffer.from([7, 8, 9]),
  });
  expect(payload).toEqual({
    session_token: 'sess-token',
    frame: {
      iv: Buffer.from([1, 2, 3]).toString('base64'),
      tag: Buffer.from([4, 5, 6]).toString('base64'),
      ciphertext: Buffer.from([7, 8, 9]).toString('base64'),
    },
  });
});

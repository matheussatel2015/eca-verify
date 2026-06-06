import { serializeFrame, deserializeFrame } from './frame-codec';

test('round-trips an encrypted frame through bytes', () => {
  const frame = { iv: Buffer.from([1, 2, 3]), tag: Buffer.from([4, 5, 6]), ciphertext: Buffer.from([7, 8, 9, 10]) };
  const bytes = serializeFrame(frame);
  expect(Buffer.isBuffer(bytes)).toBe(true);
  const back = deserializeFrame(bytes);
  expect(back.iv.equals(frame.iv)).toBe(true);
  expect(back.tag.equals(frame.tag)).toBe(true);
  expect(back.ciphertext.equals(frame.ciphertext)).toBe(true);
});

test('rejects corrupt serialized data', () => {
  expect(() => deserializeFrame(Buffer.from('not-json'))).toThrow();
});

test('rejects valid JSON that is missing required fields', () => {
  expect(() => deserializeFrame(Buffer.from('{}'))).toThrow(/required fields/);
});

import { buildDiscardEvent, DISCARD_KINDS } from './discard-event.builder';

test('builds a frame discard event', () => {
  const ev = buildDiscardEvent({ transactionId: 'tx1', tenantId: 'ten1', what: 'frame', now: new Date('2026-06-07T00:00:00Z') });
  expect(ev).toMatchObject({ id: expect.any(String), transactionId: 'tx1', tenantId: 'ten1', what: 'frame' });
  expect(ev.discardedAt).toBeInstanceOf(Date);
  expect(Object.keys(ev)).not.toContain('frame'); // proof of deletion, never the media
});

test('builds a document discard event', () => {
  const ev = buildDiscardEvent({ transactionId: 'tx2', tenantId: 'ten1', what: 'document', now: new Date() });
  expect(ev.what).toBe('document');
});

test('rejects an unknown media kind', () => {
  expect(() => buildDiscardEvent({ transactionId: 'tx3', tenantId: 'ten1', what: 'selfie' as any, now: new Date() }))
    .toThrow(/what/);
  expect(DISCARD_KINDS).toEqual(['frame', 'document']);
});

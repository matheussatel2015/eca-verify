import { MemoryFrameStore } from './memory-frame-store';

test('stores and retrieves a frame within ttl', async () => {
  let now = 1000;
  const store = new MemoryFrameStore(() => now);
  await store.put('k', Buffer.from('data'), 300);
  expect((await store.get('k'))!.toString()).toBe('data');
});

test('returns null after ttl expires', async () => {
  let now = 1000;
  const store = new MemoryFrameStore(() => now);
  await store.put('k', Buffer.from('data'), 5); // 5 seconds
  now = 1000 + 6000; // advance 6s
  expect(await store.get('k')).toBeNull();
});

test('delete removes the frame immediately', async () => {
  const store = new MemoryFrameStore(() => 1000);
  await store.put('k', Buffer.from('data'), 300);
  await store.delete('k');
  expect(await store.get('k')).toBeNull();
});

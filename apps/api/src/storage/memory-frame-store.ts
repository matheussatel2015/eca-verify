import { FrameStorePort } from './frame-store.port';

interface Entry { data: Buffer; expiresAtMs: number; }

export class MemoryFrameStore implements FrameStorePort {
  private readonly map = new Map<string, Entry>();
  constructor(private readonly nowMs: () => number = () => Date.now()) {}

  async put(key: string, data: Buffer, ttlSeconds: number): Promise<void> {
    this.map.set(key, { data, expiresAtMs: this.nowMs() + ttlSeconds * 1000 });
  }
  async get(key: string): Promise<Buffer | null> {
    const e = this.map.get(key);
    if (!e) return null;
    if (this.nowMs() >= e.expiresAtMs) { this.map.delete(key); return null; }
    return e.data;
  }
  async delete(key: string): Promise<void> {
    this.map.delete(key);
  }
}

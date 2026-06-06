export const FRAME_STORE = Symbol('FRAME_STORE');

export interface FrameStorePort {
  put(key: string, data: Buffer, ttlSeconds: number): Promise<void>;
  get(key: string): Promise<Buffer | null>;
  delete(key: string): Promise<void>;
}

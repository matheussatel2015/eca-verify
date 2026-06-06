// Minimal Redis surface used by the app — kept tiny so unit tests can fake it.
export interface RedisLike {
  incr(key: string): Promise<number>;
  pexpire(key: string, ms: number): Promise<void>;
  pttl(key: string): Promise<number>;
  /** SET key value PX ms NX — returns true if the key was set (did not exist). */
  setNx(key: string, value: string, ttlMs: number): Promise<boolean>;
}

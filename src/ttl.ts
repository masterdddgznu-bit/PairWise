import type { VirtualClock } from "./clock.js";

/** TTL index mapping keys to their expiration time (virtual clock ms). */
export class TtlIndex {
  private readonly expirations = new Map<string, number>();

  set(key: string, expireAt: number): void {
    this.expirations.set(key, expireAt);
  }

  clear(key: string): void {
    this.expirations.delete(key);
  }

  /** Keys whose expireAt <= now. */
  expiredKeys(now: number): string[] {
    const out: string[] = [];
    for (const [key, expireAt] of this.expirations) {
      if (expireAt <= now) out.push(key);
    }
    return out.sort();
  }

  /** Schedule `key` to expire `ttlMs` from the clock's current time. */
  schedule(clock: VirtualClock, key: string, ttlMs: number): void {
    this.set(key, clock.now() + ttlMs);
  }
}

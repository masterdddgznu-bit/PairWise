import type { VirtualClock } from "./clock.js";

/** TTL index mapping keys to their absolute expiration time. */
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
    const expired: string[] = [];
    for (const [key, expireAt] of this.expirations) {
      if (expireAt <= now) expired.push(key);
    }
    return expired.sort();
  }

  /** Set expiration to `clock.now() + ttlMs`. */
  schedule(clock: VirtualClock, key: string, ttlMs: number): void {
    this.set(key, clock.now() + ttlMs);
  }
}

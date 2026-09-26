import type { VirtualClock } from "./clock.js";

/**
 * TTL index — starter stub.
 * putTtl / tick need to be completed and wired from RevStore.
 */
export class TtlIndex {
  set(_key: string, _expireAt: number): void {
    throw new Error("ttl set not implemented");
  }

  clear(_key: string): void {
    // base put/delete may call clear; keep as harmless no-op
  }

  /** Keys whose expireAt <= now. */
  expiredKeys(_now: number): string[] {
    return [];
  }

  /** Helper reserved for feature work. */
  schedule(_clock: VirtualClock, _key: string, _ttlMs: number): void {
    throw new Error("ttl schedule not implemented");
  }
}

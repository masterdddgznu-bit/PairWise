import { VirtualClock } from "./clock.js";
import type { RememberResult } from "./types.js";

export type DedupTtlOptions = {
  clock: VirtualClock;
  ttl?: number;
  capacity?: number;
};

/** TTL dedup window — stub. */
export class DedupTtl {
  readonly clock: VirtualClock;

  constructor(opts: DedupTtlOptions) {
    this.clock = opts.clock;
  }

  remember(_key: string): RememberResult {
    return { inserted: false, refreshed: false, evicted: null };
  }

  seen(_key: string): boolean {
    return false;
  }

  forget(_key: string): boolean {
    return false;
  }

  expireNow(): string[] {
    return [];
  }

  tick(): string[] {
    return [];
  }

  size(): number {
    return 0;
  }

  keys(): string[] {
    return [];
  }
}

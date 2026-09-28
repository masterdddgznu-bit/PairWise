import type { VirtualClock } from "./clock.js";
import type { CreditBatch } from "./types.js";

/** Credit ledger with TTL batches — starter stub. */
export class CreditLedger {
  constructor(_clock: VirtualClock, _initial: number) {}

  creditsLeft(): number {
    throw new Error("creditsLeft not implemented");
  }

  grant(_n: number): void {
    throw new Error("grant not implemented");
  }

  offerGrant(_fromPeer: string, _n: number, _ttlMs: number): void {
    throw new Error("offerGrant not implemented");
  }

  tryConsume(_n: number): boolean {
    throw new Error("tryConsume not implemented");
  }

  reclaim(): number {
    throw new Error("reclaim not implemented");
  }

  reserve(_n: number): boolean {
    throw new Error("reserve not implemented");
  }

  release(_n: number): void {
    throw new Error("release not implemented");
  }

  statsGranted(): number {
    return 0;
  }

  statsReclaimed(): number {
    return 0;
  }
}

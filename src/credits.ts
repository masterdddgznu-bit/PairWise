import type { VirtualClock } from "./clock.js";
import { CreditError } from "./errors.js";

type ExpiringBatch = {
  remaining: number;
  expiresAt: number;
};

/**
 * Credit ledger backed by a pool of non-expiring credits (initial grants,
 * local grants, releases) plus peer batches that expire at a fixed time.
 */
export class CreditLedger {
  private permanent: number;
  private readonly batches: ExpiringBatch[] = [];
  private grantedTotal = 0;
  private reclaimedTotal = 0;

  constructor(
    private readonly clock: VirtualClock,
    initial: number,
  ) {
    if (!Number.isFinite(initial) || initial < 0) {
      throw new CreditError("initialCredits must be >= 0");
    }
    this.permanent = initial;
  }

  /**
   * Credits currently available. Batches at or past their expiry are not
   * counted here; they are removed definitively by reclaim().
   */
  creditsLeft(): number {
    const now = this.clock.now();
    let total = this.permanent;
    for (const batch of this.batches) {
      if (batch.expiresAt > now) total += batch.remaining;
    }
    return total;
  }

  grant(n: number): void {
    if (!Number.isFinite(n) || n <= 0) {
      throw new CreditError("grant amount must be > 0");
    }
    this.permanent += n;
    this.grantedTotal += n;
  }

  offerGrant(fromPeer: string, n: number, ttlMs: number): void {
    if (typeof fromPeer !== "string" || fromPeer.length === 0) {
      throw new CreditError("fromPeer must be a non-empty string");
    }
    if (!Number.isFinite(n) || n <= 0) {
      throw new CreditError("offerGrant amount must be > 0");
    }
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new CreditError("ttlMs must be >= 0");
    }
    this.batches.push({ remaining: n, expiresAt: this.clock.now() + ttlMs });
    this.grantedTotal += n;
  }

  /**
   * Consume up to n credits, preferring the soonest-expiring batch so that
   * short-lived peer credits are used first.
   */
  tryConsume(n: number): boolean {
    if (n < 0) throw new CreditError("consume amount must be >= 0");
    if (this.creditsLeft() < n) return false;

    let need = n;
    this.batches.sort((a, b) => a.expiresAt - b.expiresAt);
    for (const batch of this.batches) {
      if (need === 0) break;
      if (batch.expiresAt <= this.clock.now() || batch.remaining === 0) continue;
      const take = Math.min(batch.remaining, need);
      batch.remaining -= take;
      need -= take;
    }
    this.permanent -= need;
    return true;
  }

  /** Remove expired, unused peer credits and return how many were removed. */
  reclaim(): number {
    const now = this.clock.now();
    let removed = 0;
    for (let i = this.batches.length - 1; i >= 0; i--) {
      const batch = this.batches[i];
      if (batch.expiresAt <= now) {
        removed += batch.remaining;
        this.batches.splice(i, 1);
      }
    }
    this.reclaimedTotal += removed;
    return removed;
  }

  reserve(n: number): boolean {
    return this.tryConsume(n);
  }

  release(n: number): void {
    if (!Number.isFinite(n) || n <= 0) {
      throw new CreditError("release amount must be > 0");
    }
    this.permanent += n;
  }

  statsGranted(): number {
    return this.grantedTotal;
  }

  statsReclaimed(): number {
    return this.reclaimedTotal;
  }
}

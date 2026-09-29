import type { VirtualClock } from "./clock.js";
import type { CreditBatch } from "./types.js";
import { CreditError } from "./errors.js";

/**
 * Credit ledger.
 *
 * Credits live in batches. Local grants, initial credits and released
 * reservations never expire; peer grants carry an absolute expiry time and
 * their unused remainder can be reclaimed once the clock reaches it.
 *
 * Consumption drains soonest-expiring batches first so that credits which
 * expire earliest are used before non-expiring ones (fairness / no waste).
 */
export class CreditLedger {
  private readonly batches: CreditBatch[] = [];
  private totalGranted = 0;
  private totalReclaimed = 0;

  constructor(private readonly clock: VirtualClock, initial: number) {
    if (!Number.isFinite(initial) || initial < 0) {
      throw new CreditError("initialCredits must be >= 0");
    }
    if (initial > 0) {
      this.batches.push({ remaining: initial, expiresAt: null, fromPeer: null });
    }
  }

  creditsLeft(): number {
    let total = 0;
    for (const batch of this.batches) total += batch.remaining;
    return total;
  }

  grant(n: number): void {
    if (!Number.isFinite(n) || n <= 0) {
      throw new CreditError("grant amount must be > 0");
    }
    this.batches.push({ remaining: n, expiresAt: null, fromPeer: null });
    this.totalGranted += n;
  }

  offerGrant(fromPeer: string, n: number, ttlMs: number): void {
    if (!Number.isFinite(n) || n <= 0) {
      throw new CreditError("offerGrant amount must be > 0");
    }
    this.batches.push({
      remaining: n,
      expiresAt: this.clock.now() + ttlMs,
      fromPeer,
    });
    this.totalGranted += n;
  }

  /**
   * Deduct up to n credits, soonest-expiring batch first. Returns false
   * without mutating anything when the full amount is not available.
   */
  tryConsume(n: number): boolean {
    if (n < 0) return false;
    if (n === 0) return true;
    if (this.creditsLeft() < n) return false;
    this.deduct(n);
    return true;
  }

  reclaim(): number {
    const now = this.clock.now();
    let removed = 0;
    for (let i = this.batches.length - 1; i >= 0; i--) {
      const batch = this.batches[i];
      if (batch.expiresAt !== null && batch.expiresAt <= now && batch.remaining > 0) {
        removed += batch.remaining;
        this.batches.splice(i, 1);
      }
    }
    this.totalReclaimed += removed;
    return removed;
  }

  /** Reserve n credits (all-or-nothing) for future use. */
  reserve(n: number): boolean {
    if (n < 0) return false;
    if (n === 0) return true;
    if (this.creditsLeft() < n) return false;
    this.deduct(n);
    return true;
  }

  /** Return previously reserved credits; they never expire. */
  release(n: number): void {
    if (!Number.isFinite(n) || n <= 0) {
      throw new CreditError("release amount must be > 0");
    }
    this.batches.push({ remaining: n, expiresAt: null, fromPeer: null });
  }

  statsGranted(): number {
    return this.totalGranted;
  }

  statsReclaimed(): number {
    return this.totalReclaimed;
  }

  private deduct(n: number): void {
    let left = n;
    const expiring = this.batches
      .filter((batch) => batch.expiresAt !== null)
      .sort((a, b) => (a.expiresAt as number) - (b.expiresAt as number));
    const permanent = this.batches.filter((batch) => batch.expiresAt === null);
    for (const batch of [...expiring, ...permanent]) {
      if (left === 0) break;
      if (batch.remaining <= 0) continue;
      const take = Math.min(batch.remaining, left);
      batch.remaining -= take;
      left -= take;
    }
  }
}

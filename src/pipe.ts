import { VirtualClock } from "./clock.js";
import { BacklogQueue } from "./backlog.js";
import { CreditLedger } from "./credits.js";
import type { CreditStats } from "./types.js";

/**
 * Credit-gated message pipe (feature incomplete).
 * Base no-arg FIFO enqueue/dequeue/size/peek/clear works.
 */
export class CreditPipe {
  private readonly ready: string[] = [];
  private readonly feature: boolean;
  private readonly ledger: CreditLedger | null = null;
  private readonly backlog: BacklogQueue | null = null;
  private readonly id: string | null = null;
  private rejected = 0;
  private consumed = 0;

  constructor(clock?: VirtualClock, peerId?: string, initialCredits?: number) {
    if (clock !== undefined) {
      this.feature = true;
      this.id = peerId ?? "";
      this.ledger = new CreditLedger(clock, initialCredits ?? 0);
      this.backlog = new BacklogQueue();
    } else {
      this.feature = false;
    }
  }

  enqueue(msg: string): boolean {
    if (!this.feature) {
      this.ready.push(msg);
      return true;
    }
    throw new Error("feature enqueue not implemented");
  }

  dequeue(): string | undefined {
    return this.ready.shift();
  }

  size(): number {
    return this.ready.length;
  }

  peek(): string | undefined {
    return this.ready[0];
  }

  clear(): void {
    this.ready.length = 0;
  }

  peerId(): string {
    if (!this.feature || this.id === null) throw new Error("peerId requires feature mode");
    return this.id;
  }

  grant(_n: number): void {
    if (!this.ledger) throw new Error("grant requires feature mode");
    this.ledger.grant(_n);
  }

  creditsLeft(): number {
    if (!this.ledger) throw new Error("creditsLeft requires feature mode");
    return this.ledger.creditsLeft();
  }

  offerGrant(_fromPeer: string, _n: number, _ttlMs: number): void {
    if (!this.ledger) throw new Error("offerGrant requires feature mode");
    this.ledger.offerGrant(_fromPeer, _n, _ttlMs);
  }

  reclaim(): number {
    if (!this.ledger) throw new Error("reclaim requires feature mode");
    return this.ledger.reclaim();
  }

  flushBacklog(): number {
    if (!this.ledger || !this.backlog) throw new Error("flushBacklog requires feature mode");
    throw new Error("flushBacklog not implemented");
  }

  reserve(_n: number): boolean {
    if (!this.ledger) throw new Error("reserve requires feature mode");
    return this.ledger.reserve(_n);
  }

  release(_n: number): void {
    if (!this.ledger) throw new Error("release requires feature mode");
    this.ledger.release(_n);
  }

  sendWindow(): number {
    return this.creditsLeft();
  }

  readySize(): number {
    return this.ready.length;
  }

  backlogSize(): number {
    if (!this.backlog) return 0;
    return this.backlog.size();
  }

  stats(): CreditStats {
    return {
      granted: this.ledger?.statsGranted() ?? 0,
      consumed: this.consumed,
      reclaimed: this.ledger?.statsReclaimed() ?? 0,
      rejected: this.rejected,
    };
  }
}

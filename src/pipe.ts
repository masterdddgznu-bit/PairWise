import { VirtualClock } from "./clock.js";
import { BacklogQueue } from "./backlog.js";
import { CreditLedger } from "./credits.js";
import { CreditError } from "./errors.js";
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
    if (this.ledger!.tryConsume(1)) {
      this.consumed += 1;
      this.ready.push(msg);
      return true;
    }
    this.rejected += 1;
    this.backlog!.push(msg);
    return false;
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
    this.backlog?.clear();
  }

  peerId(): string {
    if (this.id === null) throw new CreditError("peerId requires feature mode");
    return this.id;
  }

  grant(n: number): void {
    if (!this.ledger) throw new CreditError("grant requires feature mode");
    this.ledger.grant(n);
    this.flushBacklog();
  }

  creditsLeft(): number {
    if (!this.ledger) throw new CreditError("creditsLeft requires feature mode");
    return this.ledger.creditsLeft();
  }

  offerGrant(fromPeer: string, n: number, ttlMs: number): void {
    if (!this.ledger) throw new CreditError("offerGrant requires feature mode");
    this.ledger.offerGrant(fromPeer, n, ttlMs);
    this.flushBacklog();
  }

  reclaim(): number {
    if (!this.ledger) throw new CreditError("reclaim requires feature mode");
    return this.ledger.reclaim();
  }

  flushBacklog(): number {
    if (!this.ledger || !this.backlog) {
      throw new CreditError("flushBacklog requires feature mode");
    }
    let moved = 0;
    while (this.backlog.size() > 0 && this.ledger.tryConsume(1)) {
      this.consumed += 1;
      this.ready.push(this.backlog.shift()!);
      moved += 1;
    }
    return moved;
  }

  reserve(n: number): boolean {
    if (!this.ledger) throw new CreditError("reserve requires feature mode");
    return this.ledger.reserve(n);
  }

  release(n: number): void {
    if (!this.ledger) throw new CreditError("release requires feature mode");
    this.ledger.release(n);
    this.flushBacklog();
  }

  sendWindow(): number {
    if (!this.ledger) throw new CreditError("sendWindow requires feature mode");
    return this.creditsLeft();
  }

  readySize(): number {
    return this.ready.length;
  }

  backlogSize(): number {
    return this.backlog?.size() ?? 0;
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

import { VirtualClock } from "./clock.js";
import { BucketStore } from "./bucket.js";
import {
  InvalidConfigError,
  InvalidTicketError,
  UnknownNodeError,
} from "./errors.js";
import { TicketLedger } from "./ledger.js";
import { QuotaTree } from "./tree.js";
import type {
  QuotaRingOptions,
  ReserveResult,
  UsageView,
} from "./types.js";

export class QuotaRing {
  readonly clock: VirtualClock;
  private readonly buckets = new BucketStore();
  private readonly tree: QuotaTree;
  private readonly ledger = new TicketLedger();

  constructor(opts: QuotaRingOptions) {
    if (!opts.clock) throw new InvalidConfigError("clock");
    this.clock = opts.clock;
    this.tree = new QuotaTree(opts.nodes, this.buckets);
  }

  reserve(
    nodeId: string,
    amount: number,
    ttlMs: number,
    ticketId: string,
  ): ReserveResult {
    if (!this.tree.has(nodeId)) throw new UnknownNodeError(nodeId);
    if (!ticketId) throw new InvalidTicketError("empty");
    if (!Number.isFinite(amount) || amount < 1) {
      return { ok: false, reason: "amount" };
    }
    if (!Number.isFinite(ttlMs) || ttlMs < 1) {
      return { ok: false, reason: "ttl" };
    }

    if (!this.tree.canFit(this.buckets, nodeId, amount)) {
      return { ok: false, reason: "hard" };
    }
    const expireAt = this.clock.now() + ttlMs;
    this.ledger.put({ ticketId, nodeId, remaining: amount, expireAt });
    this.tree.applyReserved(this.buckets, nodeId, amount);
    return { ok: true };
  }

  commit(ticketId: string, used: number): void {
    const t = this.ledger.get(ticketId);
    if (!t) throw new InvalidTicketError("missing");
    if (!Number.isFinite(used) || used < 0 || used > t.remaining) {
      throw new InvalidTicketError("used");
    }
    this.tree.applyCommit(this.buckets, t.nodeId, used);
    this.ledger.updateRemaining(ticketId, t.remaining - used);
  }

  release(ticketId: string): boolean {
    const t = this.ledger.delete(ticketId);
    if (!t) return false;
    this.tree.releaseReserved(this.buckets, t.nodeId, t.remaining);
    return true;
  }

  drive(): string[] {
    const ids = this.ledger.expiredIds(this.clock.now());
    for (const id of ids) {
      this.release(id);
    }
    return ids;
  }

  usage(nodeId: string): UsageView {
    if (!this.tree.has(nodeId)) throw new UnknownNodeError(nodeId);
    const c = this.buckets.get(nodeId);
    return {
      committed: c.committed,
      reserved: c.reserved,
      soft: c.soft,
      hard: c.hard,
      overSoft: this.buckets.overSoft(nodeId),
    };
  }

  canAdmit(nodeId: string, amount: number): boolean {
    if (!this.tree.has(nodeId)) throw new UnknownNodeError(nodeId);
    if (!Number.isFinite(amount) || amount < 1) return false;
    return this.tree.canFit(this.buckets, nodeId, amount);
  }
}

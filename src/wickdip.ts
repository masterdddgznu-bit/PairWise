import { VirtualClock } from "./clock.js";
import { InvalidConfigError, UnknownIdError } from "./errors.js";
import {
  Registry,
  Wick,
  assertValidCost,
  assertValidId,
  assertValidSpan,
} from "./registry.js";
import { WaxLedger } from "./ledger.js";

export interface WickDipOptions {
  clock: VirtualClock;
  maxWicks?: number;
  initialWax?: number;
}

export interface WickSnapshot {
  id: string;
  payload: unknown;
  hangAt: number;
  pullAt: number;
  cost: number;
}

function snapshot(w: Wick): WickSnapshot {
  return {
    id: w.id,
    payload: w.payload,
    hangAt: w.hangAt,
    pullAt: w.pullAt,
    cost: w.cost,
  };
}

export class WickDip {
  private readonly clock: VirtualClock;
  private readonly registry: Registry;
  private readonly ledger: WaxLedger;

  constructor(options: WickDipOptions) {
    const { clock, maxWicks = 8, initialWax = 0 } = options;
    if (
      !clock ||
      typeof clock.now !== "function" ||
      !Number.isInteger(maxWicks) ||
      maxWicks < 1 ||
      !Number.isInteger(initialWax) ||
      initialWax < 0
    ) {
      throw new InvalidConfigError("invalid WickDip configuration");
    }
    this.clock = clock;
    this.registry = new Registry(maxWicks);
    this.ledger = new WaxLedger(initialWax);
  }

  hang(
    id: string,
    payload: unknown,
    hangAt: number,
    pullAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(hangAt, pullAt);
    assertValidCost(cost);
    return { status: this.registry.hang(id, payload, hangAt, pullAt, cost) };
  }

  rehang(id: string, hangAt: number, pullAt: number): boolean {
    assertValidId(id);
    assertValidSpan(hangAt, pullAt);
    const wick = this.registry.get(id);
    if (!wick) return false;
    wick.hangAt = hangAt;
    wick.pullAt = pullAt;
    return true;
  }

  cut(id: string): boolean {
    assertValidId(id);
    return this.registry.remove(id);
  }

  peg(id: string): boolean {
    this.requireWick(id).pegged = true;
    return true;
  }

  unpeg(id: string): boolean {
    this.requireWick(id).pegged = false;
    return true;
  }

  isPegged(id: string): boolean {
    return this.requireWick(id).pegged;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  wax(): number {
    return this.ledger.wax;
  }

  peek(): WickSnapshot | null {
    const ripe = this.registry.ripeAt(this.clock.now());
    return ripe.length > 0 ? snapshot(ripe[0]) : null;
  }

  pop(): WickSnapshot | null {
    const ripe = this.registry.ripeAt(this.clock.now());
    for (const wick of ripe) {
      if (wick.cost <= this.ledger.wax) {
        this.ledger.spend(wick.cost);
        this.registry.remove(wick.id);
        return snapshot(wick);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.registry.ripeAt(this.clock.now()).map((w) => w.id);
  }

  drive(): { dipped: WickSnapshot[]; scrubbed: string[] } {
    const now = this.clock.now();
    const dipped: WickSnapshot[] = [];
    for (const wick of this.registry.ripeAt(now)) {
      if (wick.cost <= this.ledger.wax) {
        this.ledger.spend(wick.cost);
        this.registry.remove(wick.id);
        dipped.push(snapshot(wick));
      }
    }
    const scrubbed: string[] = [];
    for (const wick of this.registry.overpulledAt(now)) {
      this.registry.remove(wick.id);
      scrubbed.push(wick.id);
    }
    return { dipped, scrubbed };
  }

  ids(): string[] {
    return this.registry.inFirstHangOrder().map((w) => w.id);
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { hangAt: number; pullAt: number } | null {
    assertValidId(id);
    const wick = this.registry.get(id);
    return wick ? { hangAt: wick.hangAt, pullAt: wick.pullAt } : null;
  }

  costOf(id: string): number | null {
    assertValidId(id);
    const wick = this.registry.get(id);
    return wick ? wick.cost : null;
  }

  private requireWick(id: string): Wick {
    assertValidId(id);
    const wick = this.registry.get(id);
    if (!wick) {
      throw new UnknownIdError(`unknown wick id: ${id}`);
    }
    return wick;
  }
}

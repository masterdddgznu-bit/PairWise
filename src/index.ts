import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidCostError,
  InvalidSpanError,
} from "./errors.js";
import { WaxLedger } from "./ledger.js";
import { WickRegistry, assertValidId, type WickRecord } from "./registry.js";

export { VirtualClock } from "./clock.js";
export {
  WickDipError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidCostError,
  InvalidAmountError,
  CapacityError,
  UnknownIdError,
} from "./errors.js";

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

export interface DriveResult {
  dipped: WickSnapshot[];
  scrubbed: string[];
}

function assertValidSpan(hangAt: unknown, pullAt: unknown): void {
  if (
    !Number.isInteger(hangAt) ||
    !Number.isInteger(pullAt) ||
    (hangAt as number) < 0 ||
    (pullAt as number) < 0 ||
    (pullAt as number) <= (hangAt as number)
  ) {
    throw new InvalidSpanError(
      `invalid span: [${String(hangAt)}, ${String(pullAt)})`,
    );
  }
}

function assertValidCost(cost: unknown): void {
  if (!Number.isInteger(cost) || (cost as number) < 1) {
    throw new InvalidCostError(`invalid cost: ${String(cost)}`);
  }
}

function snapshotOf(rec: WickRecord): WickSnapshot {
  return {
    id: rec.id,
    payload: rec.payload,
    hangAt: rec.hangAt,
    pullAt: rec.pullAt,
    cost: rec.cost,
  };
}

export class WickDip {
  private readonly clock: VirtualClock;
  private readonly maxWicks: number;
  private readonly ledger: WaxLedger;
  private readonly registry = new WickRegistry();

  constructor(options: WickDipOptions) {
    const maxWicks = options.maxWicks ?? 8;
    const initialWax = options.initialWax ?? 0;
    if (!Number.isInteger(maxWicks) || maxWicks < 1) {
      throw new InvalidConfigError(
        `invalid maxWicks: ${String(options.maxWicks)}`,
      );
    }
    if (!Number.isInteger(initialWax) || initialWax < 0) {
      throw new InvalidConfigError(
        `invalid initialWax: ${String(options.initialWax)}`,
      );
    }
    this.clock = options.clock;
    this.maxWicks = maxWicks;
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
    const existing = this.registry.get(id);
    if (existing) {
      existing.payload = payload;
      existing.hangAt = hangAt;
      existing.pullAt = pullAt;
      existing.cost = cost;
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxWicks) {
      throw new CapacityError(`capacity reached: ${this.maxWicks}`);
    }
    this.registry.add(id, payload, hangAt, pullAt, cost);
    return { status: "accepted" };
  }

  rehang(id: string, hangAt: number, pullAt: number): boolean {
    assertValidId(id);
    assertValidSpan(hangAt, pullAt);
    const rec = this.registry.get(id);
    if (!rec) {
      return false;
    }
    rec.hangAt = hangAt;
    rec.pullAt = pullAt;
    return true;
  }

  cut(id: string): boolean {
    assertValidId(id);
    return this.registry.remove(id);
  }

  peg(id: string): boolean {
    assertValidId(id);
    this.registry.mustGet(id).pegged = true;
    return true;
  }

  unpeg(id: string): boolean {
    assertValidId(id);
    this.registry.mustGet(id).pegged = false;
    return true;
  }

  isPegged(id: string): boolean {
    assertValidId(id);
    return this.registry.mustGet(id).pegged;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  wax(): number {
    return this.ledger.wax();
  }

  peek(): WickSnapshot | null {
    const first = this.candidates()[0];
    return first ? snapshotOf(first) : null;
  }

  pop(): WickSnapshot | null {
    for (const rec of this.candidates()) {
      if (this.ledger.canAfford(rec.cost)) {
        this.ledger.spend(rec.cost);
        this.registry.remove(rec.id);
        return snapshotOf(rec);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.candidates().map((rec) => rec.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const dipped: WickSnapshot[] = [];
    const dippedIds = new Set<string>();
    for (const rec of this.candidatesAt(now)) {
      if (this.ledger.canAfford(rec.cost)) {
        this.ledger.spend(rec.cost);
        this.registry.remove(rec.id);
        dipped.push(snapshotOf(rec));
        dippedIds.add(rec.id);
      }
    }
    const scrubbed: string[] = [];
    for (const rec of this.registry.all()) {
      if (!rec.pegged && !dippedIds.has(rec.id) && now >= rec.pullAt) {
        this.registry.remove(rec.id);
        scrubbed.push(rec.id);
      }
    }
    return { dipped, scrubbed };
  }

  ids(): string[] {
    return this.registry.all().map((rec) => rec.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { hangAt: number; pullAt: number } | null {
    assertValidId(id);
    const rec = this.registry.get(id);
    return rec ? { hangAt: rec.hangAt, pullAt: rec.pullAt } : null;
  }

  costOf(id: string): number | null {
    assertValidId(id);
    return this.registry.get(id)?.cost ?? null;
  }

  private candidates(): WickRecord[] {
    return this.candidatesAt(this.clock.now());
  }

  private candidatesAt(now: number): WickRecord[] {
    return this.registry
      .all()
      .filter((rec) => !rec.pegged && rec.hangAt <= now && now < rec.pullAt)
      .sort((a, b) => b.hangAt - a.hangAt || a.seq - b.seq);
  }
}

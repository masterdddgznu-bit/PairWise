import { VirtualClock } from "./clock.js";
import { ClampGate } from "./clamp-gate.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSoakError,
  UnknownIdError,
} from "./errors.js";
import { HideRecord, HideRegistry } from "./registry.js";
import { LimeLedger } from "./lime-ledger.js";

export interface TanPitOptions {
  clock: VirtualClock;
  maxHides?: number;
  initialLime?: number;
}

export interface HideSnapshot {
  id: string;
  payload: unknown;
  soakAt: number;
  drainAt: number;
  cost: number;
}

export interface LoadResult {
  status: "accepted" | "updated";
}

export interface DriveResult {
  drawn: HideSnapshot[];
  scrubbed: string[];
}

function snapshotOf(rec: HideRecord): HideSnapshot {
  return {
    id: rec.id,
    payload: rec.payload,
    soakAt: rec.soakAt,
    drainAt: rec.drainAt,
    cost: rec.cost,
  };
}

export class TanPit {
  private readonly clock: VirtualClock;
  private readonly maxHides: number;
  private readonly registry = new HideRegistry();
  private readonly gate = new ClampGate();
  private readonly ledger: LimeLedger;

  constructor(opts: TanPitOptions) {
    if (!opts || !opts.clock) {
      throw new InvalidConfigError("a clock is required");
    }
    const maxHides = opts.maxHides ?? 10;
    if (!Number.isInteger(maxHides) || maxHides < 1) {
      throw new InvalidConfigError(`maxHides must be an integer >= 1, got ${maxHides}`);
    }
    const initialLime = opts.initialLime ?? 0;
    if (!Number.isInteger(initialLime) || initialLime < 0) {
      throw new InvalidConfigError(`initialLime must be an integer >= 0, got ${initialLime}`);
    }
    this.clock = opts.clock;
    this.maxHides = maxHides;
    this.ledger = new LimeLedger(initialLime);
  }

  private static checkId(id: unknown): asserts id is string {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError(`id must be a non-empty string, got ${String(id)}`);
    }
  }

  private static checkWindow(soakAt: number, drainAt: number): void {
    if (
      !Number.isInteger(soakAt) ||
      !Number.isInteger(drainAt) ||
      soakAt < 0 ||
      drainAt < 0 ||
      drainAt <= soakAt
    ) {
      throw new InvalidSoakError(
        `soak window must be finite integers >= 0 with drainAt > soakAt, got [${soakAt}, ${drainAt}]`,
      );
    }
  }

  private static checkCost(cost: number): void {
    if (!Number.isInteger(cost) || cost < 1) {
      throw new InvalidCostError(`cost must be a finite integer >= 1, got ${cost}`);
    }
  }

  private static isRipe(rec: HideRecord, now: number): boolean {
    return rec.soakAt < now && now <= rec.drainAt;
  }

  private static isOversoaked(rec: HideRecord, now: number): boolean {
    return now > rec.drainAt;
  }

  private candidatesAt(now: number): HideRecord[] {
    return this.registry
      .inFirstLoadOrder()
      .filter((rec) => !this.gate.isClamped(rec.id) && TanPit.isRipe(rec, now))
      .sort((a, b) => a.drainAt - b.drainAt || a.seq - b.seq);
  }

  load(
    id: string,
    payload: unknown,
    soakAt: number,
    drainAt: number,
    cost = 1,
  ): LoadResult {
    TanPit.checkId(id);
    TanPit.checkWindow(soakAt, drainAt);
    TanPit.checkCost(cost);
    if (this.registry.has(id)) {
      this.registry.update(id, payload, soakAt, drainAt, cost);
      return { status: "updated" };
    }
    if (this.registry.size() >= this.maxHides) {
      throw new CapacityError(`pit is full at ${this.maxHides} hides`);
    }
    this.registry.add(id, payload, soakAt, drainAt, cost);
    return { status: "accepted" };
  }

  resoak(id: string, soakAt: number, drainAt: number): boolean {
    TanPit.checkWindow(soakAt, drainAt);
    if (!this.registry.has(id)) return false;
    this.registry.resoak(id, soakAt, drainAt);
    return true;
  }

  dump(id: string): boolean {
    TanPit.checkId(id);
    if (!this.registry.has(id)) return false;
    this.registry.remove(id);
    this.gate.clear(id);
    return true;
  }

  private knownId(id: string): void {
    TanPit.checkId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown hide id: ${id}`);
    }
  }

  clamp(id: string): boolean {
    this.knownId(id);
    this.gate.clamp(id);
    return true;
  }

  unclamp(id: string): boolean {
    this.knownId(id);
    this.gate.unclamp(id);
    return true;
  }

  isClamped(id: string): boolean {
    this.knownId(id);
    return this.gate.isClamped(id);
  }

  grant(amount: number): number {
    if (!Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError(`amount must be a finite integer >= 1, got ${amount}`);
    }
    return this.ledger.grant(amount);
  }

  lime(): number {
    return this.ledger.current();
  }

  peek(): HideSnapshot | null {
    const [head] = this.candidatesAt(this.clock.now());
    return head ? snapshotOf(head) : null;
  }

  pop(): HideSnapshot | null {
    const now = this.clock.now();
    const pick = this.candidatesAt(now).find((rec) => this.ledger.canAfford(rec.cost));
    if (!pick) return null;
    this.ledger.spend(pick.cost);
    this.registry.remove(pick.id);
    this.gate.clear(pick.id);
    return snapshotOf(pick);
  }

  ripeIds(): string[] {
    return this.candidatesAt(this.clock.now()).map((rec) => rec.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const scrubbed: string[] = [];
    for (const rec of this.registry.inFirstLoadOrder()) {
      if (TanPit.isOversoaked(rec, now) && !this.gate.isClamped(rec.id)) {
        this.registry.remove(rec.id);
        this.gate.clear(rec.id);
        scrubbed.push(rec.id);
      }
    }
    const drawn: HideSnapshot[] = [];
    for (;;) {
      const pick = this.candidatesAt(now).find((rec) => this.ledger.canAfford(rec.cost));
      if (!pick) break;
      this.ledger.spend(pick.cost);
      this.registry.remove(pick.id);
      this.gate.clear(pick.id);
      drawn.push(snapshotOf(pick));
    }
    return { drawn, scrubbed };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size();
  }

  soakOf(id: string): { soakAt: number; drainAt: number } | null {
    TanPit.checkId(id);
    const rec = this.registry.get(id);
    return rec ? { soakAt: rec.soakAt, drainAt: rec.drainAt } : null;
  }

  costOf(id: string): number | null {
    TanPit.checkId(id);
    const rec = this.registry.get(id);
    return rec ? rec.cost : null;
  }
}

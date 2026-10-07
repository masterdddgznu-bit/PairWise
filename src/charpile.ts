import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import type { VirtualClock } from "./clock.js";

export interface MoundSnapshot {
  id: string;
  payload: unknown;
  bankAt: number;
  drawAt: number;
  cost: number;
}

interface Mound extends MoundSnapshot {
  seq: number;
  vented: boolean;
}

export interface CharPileOptions {
  clock: VirtualClock;
  maxMounds?: number;
  initialAir?: number;
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value >= 0;
}

export class CharPile {
  private readonly clock: VirtualClock;
  private readonly maxMounds: number;
  private airBalance: number;
  private readonly mounds = new Map<string, Mound>();
  private nextSeq = 0;

  constructor(options: CharPileOptions) {
    const { clock, maxMounds = 5, initialAir = 0 } = options ?? ({} as CharPileOptions);
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!Number.isInteger(maxMounds) || maxMounds < 1) {
      throw new InvalidConfigError("maxMounds must be an integer >= 1");
    }
    if (!isNonNegInt(initialAir)) {
      throw new InvalidConfigError("initialAir must be an integer >= 0");
    }
    this.clock = clock;
    this.maxMounds = maxMounds;
    this.airBalance = initialAir;
  }

  private checkId(id: unknown): asserts id is string {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private checkSpan(bankAt: unknown, drawAt: unknown): void {
    if (!isNonNegInt(bankAt) || !isNonNegInt(drawAt) || (drawAt as number) <= (bankAt as number)) {
      throw new InvalidSpanError("span requires finite integers 0 <= bankAt < drawAt");
    }
  }

  private checkCost(cost: unknown): void {
    if (typeof cost !== "number" || !Number.isFinite(cost) || !Number.isInteger(cost) || cost < 1) {
      throw new InvalidCostError("cost must be a finite integer >= 1");
    }
  }

  private known(id: string): Mound {
    const mound = this.mounds.get(id);
    if (!mound) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return mound;
  }

  bank(id: string, payload: unknown, bankAt: number, drawAt: number, cost = 1): { status: "accepted" | "updated" } {
    this.checkId(id);
    this.checkSpan(bankAt, drawAt);
    this.checkCost(cost);
    const existing = this.mounds.get(id);
    if (existing) {
      existing.payload = payload;
      existing.bankAt = bankAt;
      existing.drawAt = drawAt;
      existing.cost = cost;
      return { status: "updated" };
    }
    if (this.mounds.size >= this.maxMounds) {
      throw new CapacityError("mound capacity reached");
    }
    this.mounds.set(id, { id, payload, bankAt, drawAt, cost, seq: this.nextSeq++, vented: true });
    return { status: "accepted" };
  }

  rebank(id: string, bankAt: number, drawAt: number): boolean {
    this.checkId(id);
    this.checkSpan(bankAt, drawAt);
    const mound = this.mounds.get(id);
    if (!mound) {
      return false;
    }
    mound.bankAt = bankAt;
    mound.drawAt = drawAt;
    return true;
  }

  yank(id: string): boolean {
    this.checkId(id);
    return this.mounds.delete(id);
  }

  vent(id: string): boolean {
    this.checkId(id);
    this.known(id).vented = true;
    return true;
  }

  unvent(id: string): boolean {
    this.checkId(id);
    this.known(id).vented = false;
    return true;
  }

  isVented(id: string): boolean {
    this.checkId(id);
    return this.known(id).vented;
  }

  grant(amount: number): number {
    if (typeof amount !== "number" || !Number.isFinite(amount) || !Number.isInteger(amount) || amount < 1) {
      throw new InvalidAmountError("amount must be a finite integer >= 1");
    }
    this.airBalance += amount;
    return this.airBalance;
  }

  air(): number {
    return this.airBalance;
  }

  private candidates(now: number): Mound[] {
    const ripe: Mound[] = [];
    for (const mound of this.mounds.values()) {
      if (!mound.vented && mound.bankAt <= now && now <= mound.drawAt) {
        ripe.push(mound);
      }
    }
    ripe.sort((a, b) => a.bankAt - b.bankAt || b.cost - a.cost || a.seq - b.seq);
    return ripe;
  }

  private snapshot(mound: Mound): MoundSnapshot {
    return { id: mound.id, payload: mound.payload, bankAt: mound.bankAt, drawAt: mound.drawAt, cost: mound.cost };
  }

  peek(): MoundSnapshot | null {
    const ripe = this.candidates(this.clock.now());
    return ripe.length > 0 ? this.snapshot(ripe[0]) : null;
  }

  pop(): MoundSnapshot | null {
    const ripe = this.candidates(this.clock.now());
    for (const mound of ripe) {
      if (mound.cost <= this.airBalance) {
        this.airBalance -= mound.cost;
        this.mounds.delete(mound.id);
        return this.snapshot(mound);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((mound) => mound.id);
  }

  drive(): { drawn: MoundSnapshot[]; spoiled: string[] } {
    const now = this.clock.now();
    const spoiled: string[] = [];
    for (const mound of [...this.mounds.values()].sort((a, b) => a.seq - b.seq)) {
      if (!mound.vented && now > mound.drawAt) {
        spoiled.push(mound.id);
        this.mounds.delete(mound.id);
      }
    }
    const drawn: MoundSnapshot[] = [];
    for (;;) {
      const next = this.pop();
      if (!next) {
        break;
      }
      drawn.push(next);
    }
    return { drawn, spoiled };
  }

  ids(): string[] {
    return [...this.mounds.values()].sort((a, b) => a.seq - b.seq).map((mound) => mound.id);
  }

  size(): number {
    return this.mounds.size;
  }

  spanOf(id: string): { bankAt: number; drawAt: number } | null {
    this.checkId(id);
    const mound = this.mounds.get(id);
    return mound ? { bankAt: mound.bankAt, drawAt: mound.drawAt } : null;
  }

  costOf(id: string): number | null {
    this.checkId(id);
    const mound = this.mounds.get(id);
    return mound ? mound.cost : null;
  }
}

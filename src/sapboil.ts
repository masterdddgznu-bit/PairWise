import type { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { WoodLedger } from "./ledger.js";
import { LidGate } from "./lids.js";

export interface PanSnapshot<T = unknown> {
  id: string;
  payload: T;
  chargeAt: number;
  drawAt: number;
  cost: number;
}

interface Pan<T> extends PanSnapshot<T> {
  seq: number;
}

export interface SapBoilOptions {
  clock: VirtualClock;
  maxPans?: number;
  initialWood?: number;
}

const DEFAULT_MAX_PANS = 7;
const DEFAULT_INITIAL_WOOD = 0;

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertSpan(chargeAt: number, drawAt: number): void {
  if (
    !Number.isInteger(chargeAt) ||
    !Number.isInteger(drawAt) ||
    chargeAt < 0 ||
    drawAt < 0 ||
    drawAt <= chargeAt
  ) {
    throw new InvalidSpanError(
      "chargeAt/drawAt must be integers >= 0 with drawAt > chargeAt",
    );
  }
}

function assertCost(cost: number): void {
  if (!Number.isInteger(cost) || cost < 1) {
    throw new InvalidCostError("cost must be an integer >= 1");
  }
}

function snapshot<T>(pan: Pan<T>): PanSnapshot<T> {
  return {
    id: pan.id,
    payload: pan.payload,
    chargeAt: pan.chargeAt,
    drawAt: pan.drawAt,
    cost: pan.cost,
  };
}

export class SapBoil<T = unknown> {
  #clock: VirtualClock;
  #maxPans: number;
  #ledger: WoodLedger;
  #lids = new LidGate();
  #pans: Pan<T>[] = [];
  #nextSeq = 0;

  constructor(options: SapBoilOptions) {
    const { clock, maxPans = DEFAULT_MAX_PANS, initialWood = DEFAULT_INITIAL_WOOD } =
      options ?? ({} as SapBoilOptions);
    if (!clock || typeof clock.now !== "function") {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!Number.isInteger(maxPans) || maxPans < 1) {
      throw new InvalidConfigError("maxPans must be an integer >= 1");
    }
    if (!Number.isInteger(initialWood) || initialWood < 0) {
      throw new InvalidConfigError("initialWood must be an integer >= 0");
    }
    this.#clock = clock;
    this.#maxPans = maxPans;
    this.#ledger = new WoodLedger(initialWood);
  }

  charge(
    id: string,
    payload: T,
    chargeAt: number,
    drawAt: number,
    cost = 1,
  ): { status: "accepted" | "updated" } {
    assertId(id);
    assertSpan(chargeAt, drawAt);
    assertCost(cost);
    const existing = this.#find(id);
    if (existing) {
      existing.payload = payload;
      existing.chargeAt = chargeAt;
      existing.drawAt = drawAt;
      existing.cost = cost;
      return { status: "updated" };
    }
    if (this.#pans.length >= this.#maxPans) {
      throw new CapacityError("pan registry is at capacity");
    }
    this.#pans.push({ id, payload, chargeAt, drawAt, cost, seq: this.#nextSeq++ });
    this.#lids.lid(id);
    return { status: "accepted" };
  }

  recharge(id: string, chargeAt: number, drawAt: number): boolean {
    assertId(id);
    assertSpan(chargeAt, drawAt);
    const pan = this.#find(id);
    if (!pan) return false;
    pan.chargeAt = chargeAt;
    pan.drawAt = drawAt;
    return true;
  }

  dump(id: string): boolean {
    assertId(id);
    const index = this.#pans.findIndex((pan) => pan.id === id);
    if (index < 0) return false;
    this.#pans.splice(index, 1);
    this.#lids.forget(id);
    return true;
  }

  lid(id: string): boolean {
    this.#requireKnown(id);
    this.#lids.lid(id);
    return true;
  }

  unlid(id: string): boolean {
    this.#requireKnown(id);
    this.#lids.unlid(id);
    return true;
  }

  isLidded(id: string): boolean {
    this.#requireKnown(id);
    return this.#lids.isLidded(id);
  }

  grant(amount: number): number {
    return this.#ledger.grant(amount);
  }

  wood(): number {
    return this.#ledger.balance();
  }

  peek(): PanSnapshot<T> | null {
    const ranked = this.#rankedRipe(this.#clock.now());
    return ranked.length === 0 ? null : snapshot(ranked[0]);
  }

  pop(): PanSnapshot<T> | null {
    const ranked = this.#rankedRipe(this.#clock.now());
    for (const pan of ranked) {
      if (this.#ledger.canAfford(pan.cost)) {
        this.#remove(pan.id);
        this.#ledger.spend(pan.cost);
        return snapshot(pan);
      }
    }
    return null;
  }

  ripeIds(): string[] {
    return this.#rankedRipe(this.#clock.now()).map((pan) => pan.id);
  }

  drive(): { drawn: Array<PanSnapshot<T>>; boiledOff: string[] } {
    const now = this.#clock.now();
    const boiledOff: string[] = [];
    for (const pan of [...this.#pans]) {
      if (now > pan.drawAt && !this.#lids.isLidded(pan.id)) {
        this.#remove(pan.id);
        boiledOff.push(pan.id);
      }
    }
    const drawn: Array<PanSnapshot<T>> = [];
    for (;;) {
      const ranked = this.#rankedRipe(now);
      const next = ranked.find((pan) => this.#ledger.canAfford(pan.cost));
      if (!next) break;
      this.#remove(next.id);
      this.#ledger.spend(next.cost);
      drawn.push(snapshot(next));
    }
    return { drawn, boiledOff };
  }

  ids(): string[] {
    return this.#pans.map((pan) => pan.id);
  }

  size(): number {
    return this.#pans.length;
  }

  spanOf(id: string): { chargeAt: number; drawAt: number } | null {
    assertId(id);
    const pan = this.#find(id);
    return pan ? { chargeAt: pan.chargeAt, drawAt: pan.drawAt } : null;
  }

  costOf(id: string): number | null {
    assertId(id);
    const pan = this.#find(id);
    return pan ? pan.cost : null;
  }

  #find(id: string): Pan<T> | undefined {
    return this.#pans.find((pan) => pan.id === id);
  }

  #remove(id: string): void {
    const index = this.#pans.findIndex((pan) => pan.id === id);
    if (index >= 0) this.#pans.splice(index, 1);
    this.#lids.forget(id);
  }

  #requireKnown(id: string): void {
    assertId(id);
    if (!this.#find(id)) {
      throw new UnknownIdError(`unknown pan id: ${id}`);
    }
  }

  #rankedRipe(now: number): Pan<T>[] {
    return this.#pans
      .filter(
        (pan) =>
          !this.#lids.isLidded(pan.id) && pan.chargeAt < now && now <= pan.drawAt,
      )
      .sort((a, b) => b.drawAt - a.drawAt || b.cost - a.cost || a.seq - b.seq);
  }
}

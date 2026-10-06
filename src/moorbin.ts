import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidHoldError,
  InvalidIdError,
  InvalidTollError,
  InvalidUntilError,
  InvalidWeightError,
  UnknownIdError,
} from "./errors.js";
import type { VirtualClock } from "./clock.js";

export interface CrateInfo {
  id: string;
  payload: unknown;
  ripeAt: number;
  rotAt: number;
  weight: number;
  toll: number;
}

interface Crate extends CrateInfo {
  seq: number;
  mooredUntil: number | null;
}

export interface MoorBinOptions {
  clock: VirtualClock;
  maxCrates?: number;
  initialPurse?: number;
}

function isNonNegInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isPosInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

export class MoorBin {
  private readonly clock: VirtualClock;
  private readonly maxCrates: number;
  private balance: number;
  private readonly crates = new Map<string, Crate>();
  private nextSeq = 0;

  constructor(options: MoorBinOptions) {
    const maxCrates = options.maxCrates ?? 10;
    const initialPurse = options.initialPurse ?? 0;
    if (!isPosInt(maxCrates) || !isNonNegInt(initialPurse)) {
      throw new InvalidConfigError("maxCrates must be an integer >= 1 and initialPurse an integer >= 0");
    }
    this.clock = options.clock;
    this.maxCrates = maxCrates;
    this.balance = initialPurse;
  }

  private checkId(id: unknown): asserts id is string {
    if (typeof id !== "string" || id.length === 0) {
      throw new InvalidIdError("id must be a non-empty string");
    }
  }

  private checkHold(ripeAt: unknown, rotAt: unknown): void {
    if (!isNonNegInt(ripeAt) || !isNonNegInt(rotAt) || rotAt <= ripeAt) {
      throw new InvalidHoldError("ripeAt/rotAt must be integers >= 0 with rotAt > ripeAt");
    }
  }

  private checkWeight(weight: unknown): void {
    if (!isPosInt(weight)) {
      throw new InvalidWeightError("weight must be an integer >= 1");
    }
  }

  private checkToll(toll: unknown): void {
    if (!isPosInt(toll)) {
      throw new InvalidTollError("toll must be an integer >= 1");
    }
  }

  private getKnown(id: string): Crate {
    const crate = this.crates.get(id);
    if (!crate) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return crate;
  }

  private isLive(crate: Crate, now: number): boolean {
    return crate.ripeAt <= now && now < crate.rotAt;
  }

  private isMooredAt(crate: Crate, now: number): boolean {
    return crate.mooredUntil !== null && now < crate.mooredUntil;
  }

  private candidates(now: number): Crate[] {
    const result: Crate[] = [];
    for (const crate of this.crates.values()) {
      if (this.isLive(crate, now) && !this.isMooredAt(crate, now)) {
        result.push(crate);
      }
    }
    result.sort((a, b) => b.weight - a.weight || a.seq - b.seq);
    return result;
  }

  private static info(crate: Crate): CrateInfo {
    return {
      id: crate.id,
      payload: crate.payload,
      ripeAt: crate.ripeAt,
      rotAt: crate.rotAt,
      weight: crate.weight,
      toll: crate.toll,
    };
  }

  stow(
    id: string,
    payload: unknown,
    ripeAt: number,
    rotAt: number,
    weight = 1,
    toll = 1,
  ): { status: "accepted" | "updated" } {
    this.checkId(id);
    this.checkHold(ripeAt, rotAt);
    this.checkWeight(weight);
    this.checkToll(toll);
    const existing = this.crates.get(id);
    if (existing) {
      existing.payload = payload;
      existing.ripeAt = ripeAt;
      existing.rotAt = rotAt;
      existing.weight = weight;
      existing.toll = toll;
      return { status: "updated" };
    }
    if (this.crates.size >= this.maxCrates) {
      throw new CapacityError("bin is at capacity");
    }
    this.crates.set(id, {
      id,
      payload,
      ripeAt,
      rotAt,
      weight,
      toll,
      seq: this.nextSeq++,
      mooredUntil: null,
    });
    return { status: "accepted" };
  }

  restow(id: string, ripeAt: number, rotAt: number): boolean {
    this.checkId(id);
    this.checkHold(ripeAt, rotAt);
    const crate = this.crates.get(id);
    if (!crate) {
      return false;
    }
    crate.ripeAt = ripeAt;
    crate.rotAt = rotAt;
    return true;
  }

  reweigh(id: string, weight: number): boolean {
    this.checkId(id);
    this.checkWeight(weight);
    const crate = this.crates.get(id);
    if (!crate) {
      return false;
    }
    crate.weight = weight;
    return true;
  }

  dump(id: string): boolean {
    this.checkId(id);
    return this.crates.delete(id);
  }

  moor(id: string, until: number): boolean {
    this.checkId(id);
    const crate = this.getKnown(id);
    if (!isNonNegInt(until)) {
      throw new InvalidUntilError("until must be an integer >= 0");
    }
    crate.mooredUntil = until;
    return true;
  }

  unmoor(id: string): boolean {
    this.checkId(id);
    const crate = this.getKnown(id);
    crate.mooredUntil = null;
    return true;
  }

  isMoored(id: string): boolean {
    this.checkId(id);
    const crate = this.getKnown(id);
    return this.isMooredAt(crate, this.clock.now());
  }

  grant(amount: number): number {
    if (!isPosInt(amount)) {
      throw new InvalidAmountError("amount must be an integer >= 1");
    }
    this.balance += amount;
    return this.balance;
  }

  purse(): number {
    return this.balance;
  }

  peek(): CrateInfo | null {
    const candidates = this.candidates(this.clock.now());
    return candidates.length > 0 ? MoorBin.info(candidates[0]) : null;
  }

  pop(): CrateInfo | null {
    const candidates = this.candidates(this.clock.now());
    for (const crate of candidates) {
      if (crate.toll <= this.balance) {
        this.balance -= crate.toll;
        this.crates.delete(crate.id);
        return MoorBin.info(crate);
      }
    }
    return null;
  }

  liveIds(): string[] {
    return this.candidates(this.clock.now()).map((crate) => crate.id);
  }

  drive(): { shipped: CrateInfo[]; dumped: string[] } {
    const now = this.clock.now();
    const shipped: CrateInfo[] = [];
    for (;;) {
      const candidates = this.candidates(now);
      const affordable = candidates.find((crate) => crate.toll <= this.balance);
      if (!affordable) {
        break;
      }
      this.balance -= affordable.toll;
      this.crates.delete(affordable.id);
      shipped.push(MoorBin.info(affordable));
    }
    const dumped: string[] = [];
    for (const crate of this.crates.values()) {
      if (now >= crate.rotAt && !this.isMooredAt(crate, now)) {
        dumped.push(crate.id);
      }
    }
    for (const id of dumped) {
      this.crates.delete(id);
    }
    return { shipped, dumped };
  }

  ids(): string[] {
    return [...this.crates.keys()];
  }

  size(): number {
    return this.crates.size;
  }

  holdOf(id: string): { ripeAt: number; rotAt: number } | null {
    this.checkId(id);
    const crate = this.crates.get(id);
    return crate ? { ripeAt: crate.ripeAt, rotAt: crate.rotAt } : null;
  }

  weightOf(id: string): number | null {
    this.checkId(id);
    return this.crates.get(id)?.weight ?? null;
  }

  tollOf(id: string): number | null {
    this.checkId(id);
    return this.crates.get(id)?.toll ?? null;
  }
}

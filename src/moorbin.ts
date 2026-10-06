import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidIdError,
  InvalidUntilError,
  UnknownIdError,
} from "./errors.js";
import { MoorGate } from "./mooring.js";
import { Purse } from "./purse.js";
import {
  byRetrievalOrder,
  Crate,
  CrateSnapshot,
  isRipe,
  isRotten,
  Registry,
  snapshotOf,
  validateHold,
  validateId,
  validateToll,
  validateWeight,
} from "./registry.js";

export interface MoorBinOptions {
  clock: VirtualClock;
  maxCrates?: number;
  initialPurse?: number;
}

export interface DriveResult {
  shipped: CrateSnapshot[];
  dumped: string[];
}

export class MoorBin {
  private readonly clock: VirtualClock;
  private readonly registry: Registry;
  private readonly gate = new MoorGate();
  private readonly purseLedger: Purse;

  constructor(options: MoorBinOptions) {
    const { clock, maxCrates = 10, initialPurse = 0 } = options ?? {};
    if (!(clock instanceof VirtualClock)) {
      throw new InvalidConfigError("a VirtualClock is required");
    }
    if (!Number.isInteger(maxCrates) || maxCrates < 1) {
      throw new InvalidConfigError("maxCrates must be an integer >= 1");
    }
    if (!Number.isInteger(initialPurse) || initialPurse < 0) {
      throw new InvalidConfigError("initialPurse must be an integer >= 0");
    }
    this.clock = clock;
    this.registry = new Registry(maxCrates);
    this.purseLedger = new Purse(initialPurse);
  }

  stow(
    id: string,
    payload: unknown,
    ripeAt: number,
    rotAt: number,
    weight = 1,
    toll = 1,
  ): { status: "accepted" | "updated" } {
    validateId(id);
    validateHold(ripeAt, rotAt);
    validateWeight(weight);
    validateToll(toll);
    return { status: this.registry.stow(id, payload, ripeAt, rotAt, weight, toll) };
  }

  restow(id: string, ripeAt: number, rotAt: number): boolean {
    validateId(id);
    validateHold(ripeAt, rotAt);
    const crate = this.registry.get(id);
    if (!crate) return false;
    crate.ripeAt = ripeAt;
    crate.rotAt = rotAt;
    return true;
  }

  reweigh(id: string, weight: number): boolean {
    validateId(id);
    validateWeight(weight);
    const crate = this.registry.get(id);
    if (!crate) return false;
    crate.weight = weight;
    return true;
  }

  dump(id: string): boolean {
    validateId(id);
    if (!this.registry.remove(id)) return false;
    this.gate.clear(id);
    return true;
  }

  moor(id: string, until: number): boolean {
    validateId(id);
    if (!Number.isInteger(until) || until < 0) {
      throw new InvalidUntilError("until must be an integer >= 0");
    }
    this.requireKnown(id);
    this.gate.moor(id, until);
    return true;
  }

  unmoor(id: string): boolean {
    validateId(id);
    this.requireKnown(id);
    this.gate.unmoor(id);
    return true;
  }

  isMoored(id: string): boolean {
    validateId(id);
    this.requireKnown(id);
    return this.gate.isMoored(id, this.clock.now());
  }

  grant(amount: number): number {
    return this.purseLedger.grant(amount);
  }

  purse(): number {
    return this.purseLedger.available();
  }

  peek(): CrateSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): CrateSnapshot | null {
    for (const crate of this.candidates()) {
      if (!this.purseLedger.canAfford(crate.toll)) continue;
      this.purseLedger.charge(crate.toll);
      this.registry.remove(crate.id);
      this.gate.clear(crate.id);
      return snapshotOf(crate);
    }
    return null;
  }

  liveIds(): string[] {
    return this.candidates().map((crate) => crate.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const shipped: CrateSnapshot[] = [];
    for (;;) {
      const next = this.pop();
      if (!next) break;
      shipped.push(next);
    }
    const dumped: string[] = [];
    for (const crate of this.registry.all()) {
      if (!isRotten(crate, now)) continue;
      if (this.gate.isMoored(crate.id, now)) continue;
      this.registry.remove(crate.id);
      this.gate.clear(crate.id);
      dumped.push(crate.id);
    }
    return { shipped, dumped };
  }

  ids(): string[] {
    return this.registry.all().map((crate) => crate.id);
  }

  size(): number {
    return this.registry.size();
  }

  holdOf(id: string): { ripeAt: number; rotAt: number } | null {
    validateId(id);
    const crate = this.registry.get(id);
    return crate ? { ripeAt: crate.ripeAt, rotAt: crate.rotAt } : null;
  }

  weightOf(id: string): number | null {
    validateId(id);
    return this.registry.get(id)?.weight ?? null;
  }

  tollOf(id: string): number | null {
    validateId(id);
    return this.registry.get(id)?.toll ?? null;
  }

  private candidates(): Crate[] {
    const now = this.clock.now();
    return this.registry
      .all()
      .filter((crate) => isRipe(crate, now) && !this.gate.isMoored(crate.id, now))
      .sort(byRetrievalOrder);
  }

  private requireKnown(id: string): void {
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
  }
}

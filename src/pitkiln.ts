import { VirtualClock } from "./clock.js";
import { CapacityError, InvalidConfigError, UnknownIdError } from "./errors.js";
import { WoodLedger } from "./ledger.js";
import { LidGate } from "./lidgate.js";
import {
  Charge,
  ChargeRegistry,
  ChargeSnapshot,
  snapshotOf,
  validateId,
  validateSpan,
  validateWood,
} from "./registry.js";

export interface PitKilnOptions {
  clock: VirtualClock;
  maxCharges?: number;
  initialWood?: number;
}

export interface LoadResult {
  status: "accepted" | "updated";
}

export interface DriveResult {
  drawn: ChargeSnapshot[];
  banked: string[];
}

export class PitKiln {
  private readonly clock: VirtualClock;
  private readonly maxCharges: number;
  private readonly registry = new ChargeRegistry();
  private readonly lids = new LidGate();
  private readonly ledger: WoodLedger;

  constructor(options: PitKilnOptions) {
    const maxCharges = options.maxCharges ?? 5;
    const initialWood = options.initialWood ?? 0;
    if (!Number.isInteger(maxCharges) || maxCharges < 1) {
      throw new InvalidConfigError("maxCharges must be an integer >= 1");
    }
    if (!Number.isInteger(initialWood) || initialWood < 0) {
      throw new InvalidConfigError("initialWood must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxCharges = maxCharges;
    this.ledger = new WoodLedger(initialWood);
  }

  load(
    id: string,
    payload: unknown,
    kindleAt: number,
    bankAt: number,
    wood = 1,
  ): LoadResult {
    validateId(id);
    validateSpan(kindleAt, bankAt);
    validateWood(wood);
    const existing = this.registry.get(id);
    if (existing !== undefined) {
      this.registry.update(existing, payload, kindleAt, bankAt, wood);
      this.lids.unlid(id);
      return { status: "updated" };
    }
    if (this.registry.size >= this.maxCharges) {
      throw new CapacityError("kiln is at capacity");
    }
    this.registry.add(id, payload, kindleAt, bankAt, wood);
    this.lids.lid(id);
    return { status: "accepted" };
  }

  rekindle(id: string, kindleAt: number, bankAt: number): boolean {
    validateId(id);
    validateSpan(kindleAt, bankAt);
    const charge = this.registry.get(id);
    if (charge === undefined) {
      return false;
    }
    charge.kindleAt = kindleAt;
    charge.bankAt = bankAt;
    return true;
  }

  dump(id: string): boolean {
    validateId(id);
    if (!this.registry.remove(id)) {
      return false;
    }
    this.lids.clear(id);
    return true;
  }

  lid(id: string): boolean {
    this.requireKnown(id);
    this.lids.lid(id);
    return true;
  }

  unlid(id: string): boolean {
    this.requireKnown(id);
    this.lids.unlid(id);
    return true;
  }

  isLidded(id: string): boolean {
    this.requireKnown(id);
    return this.lids.isLidded(id);
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  wood(): number {
    return this.ledger.available();
  }

  peek(): ChargeSnapshot | null {
    const head = this.candidates()[0];
    return head === undefined ? null : snapshotOf(head);
  }

  pop(): ChargeSnapshot | null {
    const head = this.candidates()[0];
    if (head === undefined || !this.ledger.canAfford(head.wood)) {
      return null;
    }
    this.ledger.spend(head.wood);
    this.registry.remove(head.id);
    this.lids.clear(head.id);
    return snapshotOf(head);
  }

  ripeIds(): string[] {
    return this.candidates().map((charge) => charge.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const drawn: ChargeSnapshot[] = [];
    for (;;) {
      const head = this.candidatesAt(now)[0];
      if (head === undefined || !this.ledger.canAfford(head.wood)) {
        break;
      }
      this.ledger.spend(head.wood);
      this.registry.remove(head.id);
      this.lids.clear(head.id);
      drawn.push(snapshotOf(head));
    }
    const banked: string[] = [];
    for (const charge of this.registry.allInLoadOrder()) {
      if (charge.bankAt < now && !this.lids.isLidded(charge.id)) {
        this.registry.remove(charge.id);
        this.lids.clear(charge.id);
        banked.push(charge.id);
      }
    }
    return { drawn, banked };
  }

  ids(): string[] {
    return this.registry.idsInLoadOrder();
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { kindleAt: number; bankAt: number } | null {
    validateId(id);
    const charge = this.registry.get(id);
    if (charge === undefined) {
      return null;
    }
    return { kindleAt: charge.kindleAt, bankAt: charge.bankAt };
  }

  woodOf(id: string): number | null {
    validateId(id);
    const charge = this.registry.get(id);
    return charge === undefined ? null : charge.wood;
  }

  private requireKnown(id: string): void {
    validateId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
  }

  private candidates(): Charge[] {
    return this.candidatesAt(this.clock.now());
  }

  private candidatesAt(now: number): Charge[] {
    return this.registry
      .allInLoadOrder()
      .filter(
        (charge) =>
          !this.lids.isLidded(charge.id) &&
          charge.kindleAt < now &&
          now <= charge.bankAt,
      )
      .sort(
        (a, b) =>
          a.bankAt - b.bankAt || b.wood - a.wood || a.seq - b.seq,
      );
  }
}

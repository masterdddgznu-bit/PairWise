import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidWoodError,
  UnknownIdError,
} from "./errors.js";
import { WoodLedger } from "./ledger.js";

export interface ChargeView {
  id: string;
  payload: unknown;
  kindleAt: number;
  bankAt: number;
  wood: number;
}

interface Charge extends ChargeView {
  seq: number;
  lidded: boolean;
}

export interface PitKilnOptions {
  clock: VirtualClock;
  maxCharges?: number;
  initialWood?: number;
}

export interface DriveResult {
  drawn: ChargeView[];
  banked: string[];
}

function assertId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertSpan(kindleAt: number, bankAt: number): void {
  if (
    !Number.isInteger(kindleAt) ||
    !Number.isInteger(bankAt) ||
    kindleAt < 0 ||
    bankAt < 0 ||
    bankAt <= kindleAt
  ) {
    throw new InvalidSpanError(
      "kindleAt/bankAt must be integers >= 0 with bankAt > kindleAt",
    );
  }
}

function assertWood(wood: number): void {
  if (!Number.isInteger(wood) || wood < 1) {
    throw new InvalidWoodError("wood must be an integer >= 1");
  }
}

function viewOf(charge: Charge): ChargeView {
  return {
    id: charge.id,
    payload: charge.payload,
    kindleAt: charge.kindleAt,
    bankAt: charge.bankAt,
    wood: charge.wood,
  };
}

export class PitKiln {
  private readonly clock: VirtualClock;
  private readonly maxCharges: number;
  private readonly ledger: WoodLedger;
  private readonly charges = new Map<string, Charge>();
  private nextSeq = 0;

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

  private isFiring(charge: Charge, now: number): boolean {
    return charge.kindleAt < now && now <= charge.bankAt;
  }

  private isBanked(charge: Charge, now: number): boolean {
    return now > charge.bankAt;
  }

  private candidates(now: number): Charge[] {
    const list: Charge[] = [];
    for (const charge of this.charges.values()) {
      if (!charge.lidded && this.isFiring(charge, now)) {
        list.push(charge);
      }
    }
    list.sort((a, b) => {
      if (a.bankAt !== b.bankAt) return a.bankAt - b.bankAt;
      if (a.wood !== b.wood) return b.wood - a.wood;
      return a.seq - b.seq;
    });
    return list;
  }

  load(
    id: string,
    payload: unknown,
    kindleAt: number,
    bankAt: number,
    wood = 1,
  ): { status: "accepted" | "updated" } {
    assertId(id);
    assertSpan(kindleAt, bankAt);
    assertWood(wood);
    const existing = this.charges.get(id);
    if (existing !== undefined) {
      existing.payload = payload;
      existing.kindleAt = kindleAt;
      existing.bankAt = bankAt;
      existing.wood = wood;
      existing.lidded = false;
      return { status: "updated" };
    }
    if (this.charges.size >= this.maxCharges) {
      throw new CapacityError("kiln is at capacity");
    }
    this.charges.set(id, {
      id,
      payload,
      kindleAt,
      bankAt,
      wood,
      seq: this.nextSeq++,
      lidded: true,
    });
    return { status: "accepted" };
  }

  rekindle(id: string, kindleAt: number, bankAt: number): boolean {
    assertId(id);
    assertSpan(kindleAt, bankAt);
    const charge = this.charges.get(id);
    if (charge === undefined) return false;
    charge.kindleAt = kindleAt;
    charge.bankAt = bankAt;
    return true;
  }

  dump(id: string): boolean {
    assertId(id);
    return this.charges.delete(id);
  }

  lid(id: string): boolean {
    assertId(id);
    const charge = this.charges.get(id);
    if (charge === undefined) throw new UnknownIdError(`unknown id: ${id}`);
    charge.lidded = true;
    return true;
  }

  unlid(id: string): boolean {
    assertId(id);
    const charge = this.charges.get(id);
    if (charge === undefined) throw new UnknownIdError(`unknown id: ${id}`);
    charge.lidded = false;
    return true;
  }

  isLidded(id: string): boolean {
    assertId(id);
    const charge = this.charges.get(id);
    if (charge === undefined) throw new UnknownIdError(`unknown id: ${id}`);
    return charge.lidded;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  wood(): number {
    return this.ledger.available();
  }

  peek(): ChargeView | null {
    const head = this.candidates(this.clock.now())[0];
    return head === undefined ? null : viewOf(head);
  }

  pop(): ChargeView | null {
    const head = this.candidates(this.clock.now())[0];
    if (head === undefined || !this.ledger.canAfford(head.wood)) {
      return null;
    }
    this.ledger.spend(head.wood);
    this.charges.delete(head.id);
    return viewOf(head);
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((charge) => charge.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const drawn: ChargeView[] = [];
    for (;;) {
      const head = this.candidates(now)[0];
      if (head === undefined || !this.ledger.canAfford(head.wood)) break;
      this.ledger.spend(head.wood);
      this.charges.delete(head.id);
      drawn.push(viewOf(head));
    }
    const banked: string[] = [];
    for (const charge of [...this.charges.values()]) {
      if (!charge.lidded && this.isBanked(charge, now)) {
        this.charges.delete(charge.id);
        banked.push(charge.id);
      }
    }
    return { drawn, banked };
  }

  ids(): string[] {
    return [...this.charges.keys()];
  }

  size(): number {
    return this.charges.size;
  }

  spanOf(id: string): { kindleAt: number; bankAt: number } | null {
    assertId(id);
    const charge = this.charges.get(id);
    if (charge === undefined) return null;
    return { kindleAt: charge.kindleAt, bankAt: charge.bankAt };
  }

  woodOf(id: string): number | null {
    assertId(id);
    const charge = this.charges.get(id);
    return charge === undefined ? null : charge.wood;
  }
}

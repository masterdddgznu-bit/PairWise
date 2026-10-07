import { VirtualClock } from "./clock.js";
import { IbuLedger } from "./ledger.js";
import {
  Charge,
  Registry,
  validateId,
  validateIbu,
  validateSpan,
} from "./registry.js";
import { InvalidConfigError } from "./errors.js";

export interface HopBackOptions {
  clock: VirtualClock;
  maxCharges?: number;
  initialIbu?: number;
}

export interface ChargeView {
  id: string;
  payload: unknown;
  steepAt: number;
  dumpAt: number;
  ibu: number;
}

export interface DriveResult {
  drawn: ChargeView[];
  spent: string[];
}

function viewOf(charge: Charge): ChargeView {
  return {
    id: charge.id,
    payload: charge.payload,
    steepAt: charge.steepAt,
    dumpAt: charge.dumpAt,
    ibu: charge.ibu,
  };
}

function isRipe(charge: Charge, now: number): boolean {
  return charge.steepAt <= now && now <= charge.dumpAt;
}

function isSpent(charge: Charge, now: number): boolean {
  return now > charge.dumpAt;
}

function byRank(a: Charge, b: Charge): number {
  if (a.dumpAt !== b.dumpAt) return a.dumpAt - b.dumpAt;
  if (a.ibu !== b.ibu) return b.ibu - a.ibu;
  return a.seq - b.seq;
}

export class HopBack {
  private readonly clock: VirtualClock;
  private readonly registry: Registry;
  private readonly ledger: IbuLedger;

  constructor(options: HopBackOptions) {
    const maxCharges = options.maxCharges ?? 5;
    const initialIbu = options.initialIbu ?? 0;
    if (!Number.isInteger(maxCharges) || maxCharges < 1) {
      throw new InvalidConfigError("maxCharges must be an integer >= 1");
    }
    if (!Number.isInteger(initialIbu) || initialIbu < 0) {
      throw new InvalidConfigError("initialIbu must be an integer >= 0");
    }
    this.clock = options.clock;
    this.registry = new Registry(maxCharges);
    this.ledger = new IbuLedger(initialIbu);
  }

  charge(
    id: string,
    payload: unknown,
    steepAt: number,
    dumpAt: number,
    ibu = 1,
  ): { status: "accepted" | "updated" } {
    validateId(id);
    validateSpan(steepAt, dumpAt);
    validateIbu(ibu);
    return { status: this.registry.charge(id, payload, steepAt, dumpAt, ibu) };
  }

  retime(id: string, steepAt: number, dumpAt: number): boolean {
    validateId(id);
    validateSpan(steepAt, dumpAt);
    const charge = this.registry.get(id);
    if (!charge) return false;
    charge.steepAt = steepAt;
    charge.dumpAt = dumpAt;
    charge.plugged = false;
    return true;
  }

  toss(id: string): boolean {
    validateId(id);
    return this.registry.remove(id);
  }

  plug(id: string): boolean {
    validateId(id);
    this.registry.require(id).plugged = true;
    return true;
  }

  unplug(id: string): boolean {
    validateId(id);
    this.registry.require(id).plugged = false;
    return true;
  }

  isPlugged(id: string): boolean {
    validateId(id);
    return this.registry.require(id).plugged;
  }

  grant(amount: number): number {
    return this.ledger.grant(amount);
  }

  ibu(): number {
    return this.ledger.available();
  }

  peek(): ChargeView | null {
    const candidates = this.candidates(this.clock.now());
    return candidates.length === 0 ? null : viewOf(candidates[0]);
  }

  pop(): ChargeView | null {
    return this.drawOne(this.clock.now());
  }

  ripeIds(): string[] {
    return this.candidates(this.clock.now()).map((charge) => charge.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const spent: string[] = [];
    for (const charge of this.registry.all()) {
      if (!charge.plugged && isSpent(charge, now)) {
        spent.push(charge.id);
      }
    }
    for (const id of spent) {
      this.registry.remove(id);
    }
    const drawn: ChargeView[] = [];
    for (;;) {
      const view = this.drawOne(now);
      if (!view) break;
      drawn.push(view);
    }
    return { drawn, spent };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { steepAt: number; dumpAt: number } | null {
    validateId(id);
    const charge = this.registry.get(id);
    if (!charge) return null;
    return { steepAt: charge.steepAt, dumpAt: charge.dumpAt };
  }

  ibuOf(id: string): number | null {
    validateId(id);
    const charge = this.registry.get(id);
    return charge ? charge.ibu : null;
  }

  private candidates(now: number): Charge[] {
    return this.registry
      .all()
      .filter((charge) => !charge.plugged && isRipe(charge, now))
      .sort(byRank);
  }

  private drawOne(now: number): ChargeView | null {
    for (const charge of this.candidates(now)) {
      if (this.ledger.canAfford(charge.ibu)) {
        this.ledger.spend(charge.ibu);
        this.registry.remove(charge.id);
        return viewOf(charge);
      }
    }
    return null;
  }
}

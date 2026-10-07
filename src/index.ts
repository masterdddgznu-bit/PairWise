import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidAmountError,
  InvalidConfigError,
  InvalidIdError,
  InvalidLiquorError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { LiquorLedger } from "./ledger.js";
import { Charge, ChargeRegistry, ChargeView, viewOf } from "./registry.js";
import { RakeGate } from "./rake.js";

export { VirtualClock } from "./clock.js";
export {
  SpargeArmError,
  InvalidConfigError,
  InvalidIdError,
  InvalidSpanError,
  InvalidLiquorError,
  InvalidAmountError,
  CapacityError,
  UnknownIdError,
} from "./errors.js";
export type { ChargeView } from "./registry.js";

export interface SpargeArmOptions {
  clock: VirtualClock;
  maxCharges?: number;
  initialLiquor?: number;
}

export interface FillResult {
  status: "accepted" | "updated";
}

export interface DriveResult {
  drawn: ChargeView[];
  leftover: string[];
}

function isValidId(id: unknown): id is string {
  return typeof id === "string" && id.length > 0;
}

function isValidSpan(primeAt: unknown, cutoffAt: unknown): boolean {
  return (
    typeof primeAt === "number" &&
    typeof cutoffAt === "number" &&
    Number.isInteger(primeAt) &&
    Number.isInteger(cutoffAt) &&
    primeAt >= 0 &&
    cutoffAt >= 0 &&
    cutoffAt > primeAt
  );
}

function isValidLiquor(liquor: unknown): boolean {
  return typeof liquor === "number" && Number.isInteger(liquor) && liquor >= 1;
}

function compareCharges(a: Charge, b: Charge): number {
  if (a.primeAt !== b.primeAt) return b.primeAt - a.primeAt;
  if (a.liquor !== b.liquor) return b.liquor - a.liquor;
  return a.seq - b.seq;
}

export class SpargeArm {
  private readonly clock: VirtualClock;
  private readonly registry: ChargeRegistry;
  private readonly rake = new RakeGate();
  private readonly ledger: LiquorLedger;

  constructor(options: SpargeArmOptions) {
    const maxCharges = options?.maxCharges ?? 5;
    const initialLiquor = options?.initialLiquor ?? 0;
    if (
      !options ||
      !options.clock ||
      typeof options.clock.now !== "function" ||
      !Number.isInteger(maxCharges) ||
      maxCharges < 1 ||
      !Number.isInteger(initialLiquor) ||
      initialLiquor < 0
    ) {
      throw new InvalidConfigError("invalid sparge arm configuration");
    }
    this.clock = options.clock;
    this.registry = new ChargeRegistry(maxCharges);
    this.ledger = new LiquorLedger(initialLiquor);
  }

  fill(
    id: string,
    payload: unknown,
    primeAt: number,
    cutoffAt: number,
    liquor = 1,
  ): FillResult {
    if (!isValidId(id)) throw new InvalidIdError("id must be a non-empty string");
    if (!isValidSpan(primeAt, cutoffAt)) {
      throw new InvalidSpanError("span must be finite integers with 0 <= primeAt < cutoffAt");
    }
    if (!isValidLiquor(liquor)) {
      throw new InvalidLiquorError("liquor must be a finite integer >= 1");
    }
    const existing = this.registry.get(id);
    if (existing) {
      this.registry.update(existing, payload, primeAt, cutoffAt, liquor);
      return { status: "updated" };
    }
    if (this.registry.isFull()) {
      throw new CapacityError("maximum charges reached");
    }
    this.registry.add(id, payload, primeAt, cutoffAt, liquor);
    this.rake.engage(id);
    return { status: "accepted" };
  }

  reprime(id: string, primeAt: number, cutoffAt: number): boolean {
    if (!isValidSpan(primeAt, cutoffAt)) {
      throw new InvalidSpanError("span must be finite integers with 0 <= primeAt < cutoffAt");
    }
    const charge = this.registry.get(id);
    if (!charge) return false;
    charge.primeAt = primeAt;
    charge.cutoffAt = cutoffAt;
    this.rake.disengage(id);
    return true;
  }

  dump(id: string): boolean {
    if (!isValidId(id)) throw new InvalidIdError("id must be a non-empty string");
    if (!this.registry.remove(id)) return false;
    this.rake.clear(id);
    return true;
  }

  engage(id: string): boolean {
    this.requireKnown(id);
    this.rake.engage(id);
    return true;
  }

  disengage(id: string): boolean {
    this.requireKnown(id);
    this.rake.disengage(id);
    return true;
  }

  isEngaged(id: string): boolean {
    this.requireKnown(id);
    return this.rake.isEngaged(id);
  }

  grant(amount: number): number {
    if (!isValidLiquor(amount)) {
      throw new InvalidAmountError("amount must be a finite integer >= 1");
    }
    return this.ledger.grant(amount);
  }

  liquor(): number {
    return this.ledger.available();
  }

  peek(): ChargeView | null {
    const head = this.candidates()[0];
    return head ? viewOf(head) : null;
  }

  pop(): ChargeView | null {
    const head = this.candidates()[0];
    if (!head || !this.ledger.canAfford(head.liquor)) return null;
    this.ledger.spend(head.liquor);
    this.registry.remove(head.id);
    this.rake.clear(head.id);
    return viewOf(head);
  }

  ripeIds(): string[] {
    return this.candidates().map((charge) => charge.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const drawn: ChargeView[] = [];
    for (;;) {
      const head = this.candidates(now)[0];
      if (!head || !this.ledger.canAfford(head.liquor)) break;
      this.ledger.spend(head.liquor);
      this.registry.remove(head.id);
      this.rake.clear(head.id);
      drawn.push(viewOf(head));
    }
    const leftover: string[] = [];
    for (const charge of this.registry.all()) {
      if (now >= charge.cutoffAt && !this.rake.isEngaged(charge.id)) {
        leftover.push(charge.id);
      }
    }
    for (const id of leftover) {
      this.registry.remove(id);
      this.rake.clear(id);
    }
    return { drawn, leftover };
  }

  ids(): string[] {
    return this.registry.all().map((charge) => charge.id);
  }

  size(): number {
    return this.registry.size();
  }

  spanOf(id: string): { primeAt: number; cutoffAt: number } | null {
    if (!isValidId(id)) throw new InvalidIdError("id must be a non-empty string");
    const charge = this.registry.get(id);
    if (!charge) return null;
    return { primeAt: charge.primeAt, cutoffAt: charge.cutoffAt };
  }

  liquorOf(id: string): number | null {
    if (!isValidId(id)) throw new InvalidIdError("id must be a non-empty string");
    const charge = this.registry.get(id);
    return charge ? charge.liquor : null;
  }

  private requireKnown(id: string): void {
    if (!isValidId(id)) throw new InvalidIdError("id must be a non-empty string");
    if (!this.registry.has(id)) throw new UnknownIdError(`unknown id: ${id}`);
  }

  private candidates(now = this.clock.now()): Charge[] {
    return this.registry
      .all()
      .filter(
        (charge) =>
          charge.primeAt <= now && now < charge.cutoffAt && !this.rake.isEngaged(charge.id),
      )
      .sort(compareCharges);
  }
}

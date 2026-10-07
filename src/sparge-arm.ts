import { VirtualClock } from "./clock.js";
import {
  CapacityError,
  InvalidConfigError,
  InvalidIdError,
  InvalidLiquorError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";
import { LiquorLedger } from "./ledger.js";
import { RakeGate } from "./rake.js";
import { ChargeRecord, ChargeRegistry } from "./registry.js";

export interface SpargeArmOptions {
  clock: VirtualClock;
  maxCharges?: number;
  initialLiquor?: number;
}

export interface ChargeSnapshot {
  id: string;
  payload: unknown;
  primeAt: number;
  cutoffAt: number;
  liquor: number;
}

export interface DriveResult {
  drawn: ChargeSnapshot[];
  leftover: string[];
}

function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

function assertValidSpan(primeAt: unknown, cutoffAt: unknown): void {
  if (
    typeof primeAt !== "number" ||
    !Number.isInteger(primeAt) ||
    primeAt < 0 ||
    typeof cutoffAt !== "number" ||
    !Number.isInteger(cutoffAt) ||
    cutoffAt < 0 ||
    cutoffAt <= primeAt
  ) {
    throw new InvalidSpanError(
      "primeAt/cutoffAt must be integers >= 0 with cutoffAt > primeAt",
    );
  }
}

function assertValidLiquor(liquor: unknown): void {
  if (typeof liquor !== "number" || !Number.isInteger(liquor) || liquor < 1) {
    throw new InvalidLiquorError("liquor must be an integer >= 1");
  }
}

function snapshotOf(record: ChargeRecord): ChargeSnapshot {
  return {
    id: record.id,
    payload: record.payload,
    primeAt: record.primeAt,
    cutoffAt: record.cutoffAt,
    liquor: record.liquor,
  };
}

export class SpargeArm {
  private readonly clock: VirtualClock;
  private readonly maxCharges: number;
  private readonly ledger: LiquorLedger;
  private readonly rake = new RakeGate();
  private readonly registry = new ChargeRegistry();

  constructor(options: SpargeArmOptions) {
    const maxCharges = options.maxCharges ?? 5;
    const initialLiquor = options.initialLiquor ?? 0;
    if (
      typeof maxCharges !== "number" ||
      !Number.isInteger(maxCharges) ||
      maxCharges < 1
    ) {
      throw new InvalidConfigError("maxCharges must be an integer >= 1");
    }
    if (
      typeof initialLiquor !== "number" ||
      !Number.isInteger(initialLiquor) ||
      initialLiquor < 0
    ) {
      throw new InvalidConfigError("initialLiquor must be an integer >= 0");
    }
    this.clock = options.clock;
    this.maxCharges = maxCharges;
    this.ledger = new LiquorLedger(initialLiquor);
  }

  fill(
    id: string,
    payload: unknown,
    primeAt: number,
    cutoffAt: number,
    liquor = 1,
  ): { status: "accepted" | "updated" } {
    assertValidId(id);
    assertValidSpan(primeAt, cutoffAt);
    assertValidLiquor(liquor);
    const record: ChargeRecord = { id, payload, primeAt, cutoffAt, liquor };
    if (this.registry.has(id)) {
      this.registry.update(record);
      return { status: "updated" };
    }
    if (this.registry.size >= this.maxCharges) {
      throw new CapacityError("charge capacity reached");
    }
    this.registry.register(record);
    this.rake.engage(id);
    return { status: "accepted" };
  }

  reprime(id: string, primeAt: number, cutoffAt: number): boolean {
    assertValidId(id);
    assertValidSpan(primeAt, cutoffAt);
    const record = this.registry.get(id);
    if (!record) {
      return false;
    }
    record.primeAt = primeAt;
    record.cutoffAt = cutoffAt;
    this.rake.disengage(id);
    return true;
  }

  dump(id: string): boolean {
    assertValidId(id);
    if (!this.registry.has(id)) {
      return false;
    }
    this.registry.remove(id);
    this.rake.forget(id);
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
    return this.ledger.grant(amount);
  }

  liquor(): number {
    return this.ledger.available();
  }

  peek(): ChargeSnapshot | null {
    const head = this.candidates()[0];
    return head ? snapshotOf(head) : null;
  }

  pop(): ChargeSnapshot | null {
    const head = this.candidates()[0];
    if (!head || !this.ledger.canSpend(head.liquor)) {
      return null;
    }
    this.ledger.spend(head.liquor);
    this.registry.remove(head.id);
    this.rake.forget(head.id);
    return snapshotOf(head);
  }

  ripeIds(): string[] {
    return this.candidates().map((record) => record.id);
  }

  drive(): DriveResult {
    const now = this.clock.now();
    const drawn: ChargeSnapshot[] = [];
    for (const record of this.candidates(now)) {
      if (!this.ledger.canSpend(record.liquor)) {
        break;
      }
      this.ledger.spend(record.liquor);
      this.registry.remove(record.id);
      this.rake.forget(record.id);
      drawn.push(snapshotOf(record));
    }
    const leftover: string[] = [];
    for (const record of this.registry.entries()) {
      if (now >= record.cutoffAt && !this.rake.isEngaged(record.id)) {
        leftover.push(record.id);
      }
    }
    for (const id of leftover) {
      this.registry.remove(id);
      this.rake.forget(id);
    }
    return { drawn, leftover };
  }

  ids(): string[] {
    return this.registry.ids();
  }

  size(): number {
    return this.registry.size;
  }

  spanOf(id: string): { primeAt: number; cutoffAt: number } | null {
    assertValidId(id);
    const record = this.registry.get(id);
    return record
      ? { primeAt: record.primeAt, cutoffAt: record.cutoffAt }
      : null;
  }

  liquorOf(id: string): number | null {
    assertValidId(id);
    const record = this.registry.get(id);
    return record ? record.liquor : null;
  }

  private requireKnown(id: string): void {
    assertValidId(id);
    if (!this.registry.has(id)) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
  }

  private candidates(now = this.clock.now()): ChargeRecord[] {
    return this.registry
      .entries()
      .filter(
        (record) =>
          !this.rake.isEngaged(record.id) &&
          record.primeAt <= now &&
          now < record.cutoffAt,
      )
      .sort((a, b) => b.primeAt - a.primeAt || b.liquor - a.liquor);
  }
}

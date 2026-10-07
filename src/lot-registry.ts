import {
  CapacityError,
  InvalidIdError,
  InvalidSpanError,
  InvalidSpiritError,
  UnknownIdError,
} from "./errors.js";

export interface Lot {
  id: string;
  payload: unknown;
  softenAt: number;
  hardenAt: number;
  spirit: number;
  covered: boolean;
  seq: number;
}

export interface LotSnapshot {
  id: string;
  payload: unknown;
  softenAt: number;
  hardenAt: number;
  spirit: number;
}

export function snapshotOf(lot: Lot): LotSnapshot {
  return {
    id: lot.id,
    payload: lot.payload,
    softenAt: lot.softenAt,
    hardenAt: lot.hardenAt,
    spirit: lot.spirit,
  };
}

export function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function assertValidSpan(softenAt: unknown, hardenAt: unknown): void {
  if (
    typeof softenAt !== "number" ||
    typeof hardenAt !== "number" ||
    !Number.isInteger(softenAt) ||
    !Number.isInteger(hardenAt) ||
    softenAt < 0 ||
    hardenAt < 0 ||
    hardenAt <= softenAt
  ) {
    throw new InvalidSpanError(
      "softenAt/hardenAt must be integers >= 0 with hardenAt > softenAt",
    );
  }
}

export function assertValidSpirit(spirit: unknown): void {
  if (typeof spirit !== "number" || !Number.isInteger(spirit) || spirit < 1) {
    throw new InvalidSpiritError("spirit must be an integer >= 1");
  }
}

export class LotRegistry {
  private lots = new Map<string, Lot>();
  private nextSeq = 0;

  constructor(private readonly maxLots: number) {}

  size(): number {
    return this.lots.size;
  }

  has(id: string): boolean {
    return this.lots.has(id);
  }

  get(id: string): Lot | undefined {
    return this.lots.get(id);
  }

  require(id: string): Lot {
    const lot = this.lots.get(id);
    if (!lot) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return lot;
  }

  all(): Lot[] {
    return [...this.lots.values()];
  }

  charge(
    id: string,
    payload: unknown,
    softenAt: number,
    hardenAt: number,
    spirit: number,
  ): "accepted" | "updated" {
    const existing = this.lots.get(id);
    if (existing) {
      existing.payload = payload;
      existing.softenAt = softenAt;
      existing.hardenAt = hardenAt;
      existing.spirit = spirit;
      existing.covered = true;
      return "updated";
    }
    if (this.lots.size >= this.maxLots) {
      throw new CapacityError("pan is at capacity");
    }
    this.lots.set(id, {
      id,
      payload,
      softenAt,
      hardenAt,
      spirit,
      covered: true,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  remove(id: string): boolean {
    return this.lots.delete(id);
  }
}

export function compareLots(a: Lot, b: Lot): number {
  if (a.hardenAt !== b.hardenAt) return a.hardenAt - b.hardenAt;
  if (a.spirit !== b.spirit) return a.spirit - b.spirit;
  return a.seq - b.seq;
}

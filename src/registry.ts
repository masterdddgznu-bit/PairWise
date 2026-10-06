import {
  CapacityError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";

export interface Lot {
  id: string;
  payload: unknown;
  steepAt: number;
  liftAt: number;
  cost: number;
  sunk: boolean;
  seq: number;
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateSpan(steepAt: unknown, liftAt: unknown): void {
  if (
    !Number.isInteger(steepAt) ||
    !Number.isInteger(liftAt) ||
    (steepAt as number) < 0 ||
    (liftAt as number) < 0 ||
    (liftAt as number) <= (steepAt as number)
  ) {
    throw new InvalidSpanError(
      "steepAt/liftAt must be integers >= 0 with liftAt > steepAt",
    );
  }
}

export function validateCost(cost: unknown): void {
  if (!Number.isInteger(cost) || (cost as number) < 1) {
    throw new InvalidCostError("cost must be an integer >= 1");
  }
}

export class LotRegistry {
  private lots = new Map<string, Lot>();
  private nextSeq = 0;

  constructor(private readonly maxLots: number) {}

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

  size(): number {
    return this.lots.size;
  }

  upsert(
    id: string,
    payload: unknown,
    steepAt: number,
    liftAt: number,
    cost: number,
  ): "accepted" | "updated" {
    const existing = this.lots.get(id);
    if (existing) {
      existing.payload = payload;
      existing.steepAt = steepAt;
      existing.liftAt = liftAt;
      existing.cost = cost;
      return "updated";
    }
    if (this.lots.size >= this.maxLots) {
      throw new CapacityError("vat is at capacity");
    }
    this.lots.set(id, {
      id,
      payload,
      steepAt,
      liftAt,
      cost,
      sunk: false,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  remove(id: string): boolean {
    return this.lots.delete(id);
  }

  inFirstSteepOrder(): Lot[] {
    return [...this.lots.values()].sort((a, b) => a.seq - b.seq);
  }
}

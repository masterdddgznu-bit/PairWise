import { InvalidCostError, InvalidIdError, InvalidSpanError } from "./errors.js";

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
    typeof steepAt !== "number" ||
    typeof liftAt !== "number" ||
    !Number.isInteger(steepAt) ||
    !Number.isInteger(liftAt) ||
    steepAt < 0 ||
    liftAt < 0 ||
    liftAt <= steepAt
  ) {
    throw new InvalidSpanError(
      "steepAt/liftAt must be integers >= 0 with liftAt > steepAt",
    );
  }
}

export function validateCost(cost: unknown): void {
  if (typeof cost !== "number" || !Number.isInteger(cost) || cost < 1) {
    throw new InvalidCostError("cost must be an integer >= 1");
  }
}

export class LotRegistry {
  private lots = new Map<string, Lot>();
  private nextSeq = 0;

  get size(): number {
    return this.lots.size;
  }

  has(id: string): boolean {
    return this.lots.has(id);
  }

  get(id: string): Lot | undefined {
    return this.lots.get(id);
  }

  add(id: string, payload: unknown, steepAt: number, liftAt: number, cost: number): Lot {
    const lot: Lot = {
      id,
      payload,
      steepAt,
      liftAt,
      cost,
      sunk: false,
      seq: this.nextSeq++,
    };
    this.lots.set(id, lot);
    return lot;
  }

  remove(id: string): boolean {
    return this.lots.delete(id);
  }

  /** All lots in first-registration order. */
  all(): Lot[] {
    return [...this.lots.values()];
  }

  ids(): string[] {
    return [...this.lots.keys()];
  }
}

/** Open-open steep window: ripe iff steepAt < now < liftAt. */
export function isRipe(lot: Lot, now: number): boolean {
  return lot.steepAt < now && now < lot.liftAt;
}

export function isOverretted(lot: Lot, now: number): boolean {
  return now >= lot.liftAt;
}

/** Ranking: higher cost, then sooner liftAt, then first-registration order. */
export function compareCandidates(a: Lot, b: Lot): number {
  if (a.cost !== b.cost) return b.cost - a.cost;
  if (a.liftAt !== b.liftAt) return a.liftAt - b.liftAt;
  return a.seq - b.seq;
}

import { CapacityError } from "./errors.js";

export interface Lot {
  id: string;
  payload: unknown;
  steepAt: number;
  drainAt: number;
  water: number;
  seq: number;
}

export class LotRegistry {
  #lots = new Map<string, Lot>();
  #nextSeq = 0;

  constructor(private readonly maxLots: number) {}

  has(id: string): boolean {
    return this.#lots.has(id);
  }

  get(id: string): Lot | undefined {
    return this.#lots.get(id);
  }

  size(): number {
    return this.#lots.size;
  }

  upsert(
    id: string,
    payload: unknown,
    steepAt: number,
    drainAt: number,
    water: number,
  ): "accepted" | "updated" {
    const existing = this.#lots.get(id);
    if (existing) {
      existing.payload = payload;
      existing.steepAt = steepAt;
      existing.drainAt = drainAt;
      existing.water = water;
      return "updated";
    }
    if (this.#lots.size >= this.maxLots) {
      throw new CapacityError(`cistern is full (${this.maxLots} lots)`);
    }
    this.#lots.set(id, {
      id,
      payload,
      steepAt,
      drainAt,
      water,
      seq: this.#nextSeq++,
    });
    return "accepted";
  }

  remove(id: string): boolean {
    return this.#lots.delete(id);
  }

  entries(): Lot[] {
    return [...this.#lots.values()];
  }
}

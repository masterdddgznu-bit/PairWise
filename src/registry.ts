import {
  CapacityError,
  InvalidCostError,
  InvalidIdError,
  InvalidSpanError,
  UnknownIdError,
} from "./errors.js";

export interface Pocket {
  id: string;
  payload: unknown;
  loadAt: number;
  unloadAt: number;
  cost: number;
  sealed: boolean;
  seq: number;
}

export interface PocketSnapshot {
  id: string;
  payload: unknown;
  loadAt: number;
  unloadAt: number;
  cost: number;
}

export function validateId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function validateSpan(loadAt: unknown, unloadAt: unknown): void {
  if (
    !Number.isInteger(loadAt) ||
    !Number.isInteger(unloadAt) ||
    (loadAt as number) < 0 ||
    (unloadAt as number) < 0 ||
    (unloadAt as number) <= (loadAt as number)
  ) {
    throw new InvalidSpanError(
      "loadAt/unloadAt must be integers >= 0 with unloadAt > loadAt",
    );
  }
}

export function validateCost(cost: unknown): void {
  if (!Number.isInteger(cost) || (cost as number) < 1) {
    throw new InvalidCostError("cost must be an integer >= 1");
  }
}

export class PocketRegistry {
  private readonly pockets = new Map<string, Pocket>();
  private nextSeq = 0;

  constructor(private readonly maxPockets: number) {}

  load(
    id: string,
    payload: unknown,
    loadAt: number,
    unloadAt: number,
    cost: number,
  ): "accepted" | "updated" {
    validateId(id);
    validateSpan(loadAt, unloadAt);
    validateCost(cost);
    const existing = this.pockets.get(id);
    if (existing) {
      existing.payload = payload;
      existing.loadAt = loadAt;
      existing.unloadAt = unloadAt;
      existing.cost = cost;
      return "updated";
    }
    if (this.pockets.size >= this.maxPockets) {
      throw new CapacityError("no free pockets");
    }
    this.pockets.set(id, {
      id,
      payload,
      loadAt,
      unloadAt,
      cost,
      sealed: true,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  reload(id: string, loadAt: number, unloadAt: number): boolean {
    validateSpan(loadAt, unloadAt);
    const pocket = this.pockets.get(id);
    if (!pocket) return false;
    pocket.loadAt = loadAt;
    pocket.unloadAt = unloadAt;
    return true;
  }

  dump(id: string): boolean {
    validateId(id);
    return this.pockets.delete(id);
  }

  get(id: string): Pocket {
    validateId(id);
    const pocket = this.pockets.get(id);
    if (!pocket) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return pocket;
  }

  find(id: string): Pocket | undefined {
    return this.pockets.get(id);
  }

  remove(id: string): void {
    this.pockets.delete(id);
  }

  ids(): string[] {
    return [...this.pockets.keys()];
  }

  size(): number {
    return this.pockets.size;
  }

  inFirstLoadOrder(): Pocket[] {
    return [...this.pockets.values()];
  }
}

export function snapshotOf(pocket: Pocket): PocketSnapshot {
  return {
    id: pocket.id,
    payload: pocket.payload,
    loadAt: pocket.loadAt,
    unloadAt: pocket.unloadAt,
    cost: pocket.cost,
  };
}

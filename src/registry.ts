import { CapacityError } from "./errors.js";

export interface Pocket {
  id: string;
  payload: unknown;
  loadAt: number;
  unloadAt: number;
  cost: number;
  seq: number;
}

export class PocketRegistry {
  private readonly pockets = new Map<string, Pocket>();
  private nextSeq = 0;

  constructor(private readonly maxPockets: number) {}

  has(id: string): boolean {
    return this.pockets.has(id);
  }

  get(id: string): Pocket | undefined {
    return this.pockets.get(id);
  }

  get size(): number {
    return this.pockets.size;
  }

  load(
    id: string,
    payload: unknown,
    loadAt: number,
    unloadAt: number,
    cost: number,
  ): "accepted" | "updated" {
    const existing = this.pockets.get(id);
    if (existing) {
      existing.payload = payload;
      existing.loadAt = loadAt;
      existing.unloadAt = unloadAt;
      existing.cost = cost;
      return "updated";
    }
    if (this.pockets.size >= this.maxPockets) {
      throw new CapacityError(`kiln is full (${this.maxPockets} pockets)`);
    }
    this.pockets.set(id, {
      id,
      payload,
      loadAt,
      unloadAt,
      cost,
      seq: this.nextSeq++,
    });
    return "accepted";
  }

  reload(id: string, loadAt: number, unloadAt: number): boolean {
    const existing = this.pockets.get(id);
    if (!existing) {
      return false;
    }
    existing.loadAt = loadAt;
    existing.unloadAt = unloadAt;
    return true;
  }

  dump(id: string): boolean {
    return this.pockets.delete(id);
  }

  entries(): Pocket[] {
    return [...this.pockets.values()];
  }
}

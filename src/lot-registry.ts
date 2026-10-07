export interface Lot {
  id: string;
  payload: unknown;
  steepAt: number;
  drainAt: number;
  water: number;
  seq: number;
}

export interface LotSnapshot {
  id: string;
  payload: unknown;
  steepAt: number;
  drainAt: number;
  water: number;
}

export function snapshotOf(lot: Lot): LotSnapshot {
  return {
    id: lot.id,
    payload: lot.payload,
    steepAt: lot.steepAt,
    drainAt: lot.drainAt,
    water: lot.water,
  };
}

// Map insertion order doubles as the first-load order; updates mutate in
// place so they never disturb it, while dump + re-load appends anew.
export class LotRegistry {
  private lots = new Map<string, Lot>();
  private nextSeq = 0;

  get size(): number {
    return this.lots.size;
  }

  get(id: string): Lot | undefined {
    return this.lots.get(id);
  }

  has(id: string): boolean {
    return this.lots.has(id);
  }

  add(id: string, payload: unknown, steepAt: number, drainAt: number, water: number): Lot {
    const lot: Lot = { id, payload, steepAt, drainAt, water, seq: this.nextSeq++ };
    this.lots.set(id, lot);
    return lot;
  }

  remove(id: string): boolean {
    return this.lots.delete(id);
  }

  all(): Lot[] {
    return [...this.lots.values()];
  }

  ids(): string[] {
    return [...this.lots.keys()];
  }
}

// Take-out ranking: later drainAt first, then lower water, then
// first-load sequence.
export function compareByRank(a: Lot, b: Lot): number {
  if (a.drainAt !== b.drainAt) return b.drainAt - a.drainAt;
  if (a.water !== b.water) return a.water - b.water;
  return a.seq - b.seq;
}

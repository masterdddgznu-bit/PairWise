export interface Lot {
  id: string;
  payload: unknown;
  readyAt: number;
  spoilAt: number;
  cost: number;
  seq: number;
  sealed: boolean;
}

export interface LotSnapshot {
  id: string;
  payload: unknown;
  readyAt: number;
  spoilAt: number;
  cost: number;
}

export function snapshotOf(lot: Lot): LotSnapshot {
  return {
    id: lot.id,
    payload: lot.payload,
    readyAt: lot.readyAt,
    spoilAt: lot.spoilAt,
    cost: lot.cost,
  };
}

export function isRipe(lot: Lot, now: number): boolean {
  return lot.readyAt <= now && now < lot.spoilAt;
}

export function isSpoiled(lot: Lot, now: number): boolean {
  return now >= lot.spoilAt;
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

  add(id: string, payload: unknown, readyAt: number, spoilAt: number, cost: number): Lot {
    const lot: Lot = {
      id,
      payload,
      readyAt,
      spoilAt,
      cost,
      seq: this.nextSeq++,
      sealed: true,
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

  /**
   * Lots matching `filter`, ordered for withdrawal:
   * later readyAt first, ties broken by first-registration order.
   */
  ranked(filter: (lot: Lot) => boolean): Lot[] {
    return this.all()
      .filter(filter)
      .sort((a, b) => b.readyAt - a.readyAt || a.seq - b.seq);
  }
}

export interface Lot {
  id: string;
  payload: unknown;
  readyAt: number;
  spoilAt: number;
  cost: number;
  sealed: boolean;
  seq: number;
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

  get size(): number {
    return this.lots.size;
  }

  get isFull(): boolean {
    return this.lots.size >= this.maxLots;
  }

  register(
    id: string,
    payload: unknown,
    readyAt: number,
    spoilAt: number,
    cost: number,
  ): Lot {
    const lot: Lot = {
      id,
      payload,
      readyAt,
      spoilAt,
      cost,
      sealed: true,
      seq: this.nextSeq++,
    };
    this.lots.set(id, lot);
    return lot;
  }

  remove(id: string): boolean {
    return this.lots.delete(id);
  }

  /** All lots in first-registration order. */
  inOrder(): Lot[] {
    return [...this.lots.values()].sort((a, b) => a.seq - b.seq);
  }
}

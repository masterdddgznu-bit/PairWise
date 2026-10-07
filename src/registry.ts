export interface Lot {
  id: string;
  payload: unknown;
  mashAt: number;
  runoffAt: number;
  gravity: number;
}

export class LotRegistry {
  private readonly lots = new Map<string, Lot>();

  has(id: string): boolean {
    return this.lots.has(id);
  }

  get(id: string): Lot | undefined {
    return this.lots.get(id);
  }

  size(): number {
    return this.lots.size;
  }

  add(lot: Lot): void {
    this.lots.set(lot.id, lot);
  }

  update(lot: Lot): void {
    this.lots.set(lot.id, lot);
  }

  remove(id: string): boolean {
    return this.lots.delete(id);
  }

  ids(): string[] {
    return [...this.lots.keys()];
  }

  entries(): Lot[] {
    return [...this.lots.values()];
  }
}

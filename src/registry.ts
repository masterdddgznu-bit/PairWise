export interface ChargeRecord {
  id: string;
  payload: unknown;
  primeAt: number;
  cutoffAt: number;
  liquor: number;
}

export class ChargeRegistry {
  private charges = new Map<string, ChargeRecord>();

  has(id: string): boolean {
    return this.charges.has(id);
  }

  get(id: string): ChargeRecord | undefined {
    return this.charges.get(id);
  }

  get size(): number {
    return this.charges.size;
  }

  register(record: ChargeRecord): void {
    this.charges.set(record.id, record);
  }

  update(record: ChargeRecord): void {
    this.charges.set(record.id, record);
  }

  remove(id: string): void {
    this.charges.delete(id);
  }

  ids(): string[] {
    return [...this.charges.keys()];
  }

  entries(): ChargeRecord[] {
    return [...this.charges.values()];
  }
}

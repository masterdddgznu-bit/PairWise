export interface ChargeEntry {
  id: string;
  payload: unknown;
  steepAt: number;
  dumpAt: number;
  ibu: number;
  seq: number;
}

export class ChargeRegistry {
  private readonly entries = new Map<string, ChargeEntry>();
  private nextSeq = 0;

  get size(): number {
    return this.entries.size;
  }

  get(id: string): ChargeEntry | undefined {
    return this.entries.get(id);
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  add(id: string, payload: unknown, steepAt: number, dumpAt: number, ibu: number): ChargeEntry {
    const entry: ChargeEntry = { id, payload, steepAt, dumpAt, ibu, seq: this.nextSeq++ };
    this.entries.set(id, entry);
    return entry;
  }

  remove(id: string): boolean {
    return this.entries.delete(id);
  }

  inOrder(): ChargeEntry[] {
    return [...this.entries.values()];
  }
}

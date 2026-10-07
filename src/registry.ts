export interface ButtRecord {
  id: string;
  payload: unknown;
  fillAt: number;
  drawAt: number;
  share: number;
}

export class ButtRegistry {
  private readonly butts = new Map<string, ButtRecord>();

  has(id: string): boolean {
    return this.butts.has(id);
  }

  get(id: string): ButtRecord | undefined {
    return this.butts.get(id);
  }

  size(): number {
    return this.butts.size;
  }

  register(record: ButtRecord): void {
    this.butts.set(record.id, record);
  }

  remove(id: string): void {
    this.butts.delete(id);
  }

  ids(): string[] {
    return [...this.butts.keys()];
  }

  entries(): ButtRecord[] {
    return [...this.butts.values()];
  }
}

export interface HeapRecord {
  id: string;
  payload: unknown;
  couchAt: number;
  kilnAt: number;
  mist: number;
  sheeted: boolean;
  seq: number;
}

export class HeapRegistry {
  private readonly records = new Map<string, HeapRecord>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.records.has(id);
  }

  get(id: string): HeapRecord | undefined {
    return this.records.get(id);
  }

  size(): number {
    return this.records.size;
  }

  add(id: string, payload: unknown, couchAt: number, kilnAt: number, mist: number): HeapRecord {
    const record: HeapRecord = {
      id,
      payload,
      couchAt,
      kilnAt,
      mist,
      sheeted: true,
      seq: this.nextSeq++,
    };
    this.records.set(id, record);
    return record;
  }

  remove(id: string): boolean {
    return this.records.delete(id);
  }

  idsInFirstLoadOrder(): string[] {
    return [...this.records.values()]
      .sort((a, b) => a.seq - b.seq)
      .map((record) => record.id);
  }

  allInFirstLoadOrder(): HeapRecord[] {
    return [...this.records.values()].sort((a, b) => a.seq - b.seq);
  }
}

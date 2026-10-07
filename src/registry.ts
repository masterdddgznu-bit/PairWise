export interface ButtRecord {
  id: string;
  payload: unknown;
  fillAt: number;
  drawAt: number;
  share: number;
  seq: number;
}

export class ButtRegistry {
  private readonly records = new Map<string, ButtRecord>();
  private nextSeq = 0;

  get(id: string): ButtRecord | undefined {
    return this.records.get(id);
  }

  has(id: string): boolean {
    return this.records.has(id);
  }

  size(): number {
    return this.records.size;
  }

  add(id: string, payload: unknown, fillAt: number, drawAt: number, share: number): ButtRecord {
    const record: ButtRecord = { id, payload, fillAt, drawAt, share, seq: this.nextSeq++ };
    this.records.set(id, record);
    return record;
  }

  delete(id: string): boolean {
    return this.records.delete(id);
  }

  inSeqOrder(): ButtRecord[] {
    return [...this.records.values()].sort((a, b) => a.seq - b.seq);
  }
}

export interface ParcelRecord {
  id: string;
  payload: unknown;
  rimeAt: number;
  thawAt: number;
  chill: number;
  sealed: boolean;
  seq: number;
}

export class ParcelRegistry {
  private records = new Map<string, ParcelRecord>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.records.has(id);
  }

  get(id: string): ParcelRecord | undefined {
    return this.records.get(id);
  }

  size(): number {
    return this.records.size;
  }

  add(id: string, payload: unknown, rimeAt: number, thawAt: number, chill: number): ParcelRecord {
    const record: ParcelRecord = {
      id,
      payload,
      rimeAt,
      thawAt,
      chill,
      sealed: false,
      seq: this.nextSeq++,
    };
    this.records.set(id, record);
    return record;
  }

  remove(id: string): boolean {
    return this.records.delete(id);
  }

  all(): ParcelRecord[] {
    return [...this.records.values()];
  }

  ids(): string[] {
    return [...this.records.keys()];
  }
}

export function compareRank(a: ParcelRecord, b: ParcelRecord): number {
  if (a.chill !== b.chill) return b.chill - a.chill;
  if (a.thawAt !== b.thawAt) return a.thawAt - b.thawAt;
  return a.seq - b.seq;
}

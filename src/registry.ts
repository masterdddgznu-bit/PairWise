export interface BloomRecord {
  id: string;
  payload: unknown;
  glowAt: number;
  chillAt: number;
  char: number;
  seq: number;
}

export class BloomRegistry {
  private records = new Map<string, BloomRecord>();
  private nextSeq = 0;

  constructor(private readonly maxBlooms: number) {}

  has(id: string): boolean {
    return this.records.has(id);
  }

  get(id: string): BloomRecord | undefined {
    return this.records.get(id);
  }

  size(): number {
    return this.records.size;
  }

  isFull(): boolean {
    return this.records.size >= this.maxBlooms;
  }

  add(
    id: string,
    payload: unknown,
    glowAt: number,
    chillAt: number,
    char: number,
  ): BloomRecord {
    const record: BloomRecord = { id, payload, glowAt, chillAt, char, seq: this.nextSeq++ };
    this.records.set(id, record);
    return record;
  }

  update(
    record: BloomRecord,
    payload: unknown,
    glowAt: number,
    chillAt: number,
    char: number,
  ): void {
    record.payload = payload;
    record.glowAt = glowAt;
    record.chillAt = chillAt;
    record.char = char;
  }

  retune(record: BloomRecord, glowAt: number, chillAt: number): void {
    record.glowAt = glowAt;
    record.chillAt = chillAt;
  }

  remove(id: string): boolean {
    return this.records.delete(id);
  }

  ids(): string[] {
    return [...this.records.keys()];
  }

  values(): BloomRecord[] {
    return [...this.records.values()];
  }
}

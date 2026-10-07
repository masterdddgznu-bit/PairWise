export interface LineRecord {
  id: string;
  payload: unknown;
  hitchAt: number;
  castAt: number;
  turns: number;
  seq: number;
}

export type WindowState = "pending" | "live" | "spent";

export class LineRegistry {
  private lines = new Map<string, LineRecord>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.lines.has(id);
  }

  get(id: string): LineRecord | undefined {
    return this.lines.get(id);
  }

  size(): number {
    return this.lines.size;
  }

  add(id: string, payload: unknown, hitchAt: number, castAt: number, turns: number): LineRecord {
    const record: LineRecord = {
      id,
      payload,
      hitchAt,
      castAt,
      turns,
      seq: this.nextSeq++,
    };
    this.lines.set(id, record);
    return record;
  }

  remove(id: string): boolean {
    return this.lines.delete(id);
  }

  ids(): string[] {
    return [...this.lines.keys()];
  }

  entries(): LineRecord[] {
    return [...this.lines.values()];
  }

  static windowState(record: LineRecord, now: number): WindowState {
    if (now < record.hitchAt) return "pending";
    if (now >= record.castAt) return "spent";
    return "live";
  }

  static compareRank(a: LineRecord, b: LineRecord): number {
    if (a.castAt !== b.castAt) return b.castAt - a.castAt;
    if (a.turns !== b.turns) return a.turns - b.turns;
    return a.seq - b.seq;
  }
}

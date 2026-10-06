import { InvalidIdError, UnknownIdError } from "./errors.js";

export interface WickRecord {
  id: string;
  payload: unknown;
  hangAt: number;
  pullAt: number;
  cost: number;
  pegged: boolean;
  seq: number;
}

export function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError(`invalid id: ${String(id)}`);
  }
}

export class WickRegistry {
  private readonly records = new Map<string, WickRecord>();
  private nextSeq = 0;

  has(id: string): boolean {
    return this.records.has(id);
  }

  get(id: string): WickRecord | undefined {
    return this.records.get(id);
  }

  mustGet(id: string): WickRecord {
    const rec = this.records.get(id);
    if (!rec) {
      throw new UnknownIdError(`unknown id: ${id}`);
    }
    return rec;
  }

  size(): number {
    return this.records.size;
  }

  add(
    id: string,
    payload: unknown,
    hangAt: number,
    pullAt: number,
    cost: number,
  ): WickRecord {
    const rec: WickRecord = {
      id,
      payload,
      hangAt,
      pullAt,
      cost,
      pegged: true,
      seq: this.nextSeq++,
    };
    this.records.set(id, rec);
    return rec;
  }

  remove(id: string): boolean {
    return this.records.delete(id);
  }

  all(): WickRecord[] {
    return [...this.records.values()].sort((a, b) => a.seq - b.seq);
  }
}

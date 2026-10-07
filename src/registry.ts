import { InvalidIdError, InvalidSpanError } from "./errors.js";

export interface HeapRecord {
  id: string;
  payload: unknown;
  couchAt: number;
  kilnAt: number;
  mist: number;
  seq: number;
}

export function assertValidId(id: unknown): asserts id is string {
  if (typeof id !== "string" || id.length === 0) {
    throw new InvalidIdError("id must be a non-empty string");
  }
}

export function assertValidSpan(couchAt: unknown, kilnAt: unknown): void {
  if (
    typeof couchAt !== "number" ||
    typeof kilnAt !== "number" ||
    !Number.isInteger(couchAt) ||
    !Number.isInteger(kilnAt) ||
    couchAt < 0 ||
    kilnAt < 0 ||
    kilnAt <= couchAt
  ) {
    throw new InvalidSpanError(
      "couchAt/kilnAt must be integers >= 0 with kilnAt > couchAt",
    );
  }
}

export class HeapRegistry {
  private readonly heaps = new Map<string, HeapRecord>();
  private nextSeq = 0;

  get size(): number {
    return this.heaps.size;
  }

  has(id: string): boolean {
    return this.heaps.has(id);
  }

  get(id: string): HeapRecord | undefined {
    return this.heaps.get(id);
  }

  add(
    id: string,
    payload: unknown,
    couchAt: number,
    kilnAt: number,
    mist: number,
  ): HeapRecord {
    const record: HeapRecord = {
      id,
      payload,
      couchAt,
      kilnAt,
      mist,
      seq: this.nextSeq++,
    };
    this.heaps.set(id, record);
    return record;
  }

  remove(id: string): boolean {
    return this.heaps.delete(id);
  }

  allInFirstLoadOrder(): HeapRecord[] {
    return [...this.heaps.values()].sort((a, b) => a.seq - b.seq);
  }
}

export function compareForDraw(a: HeapRecord, b: HeapRecord): number {
  if (a.kilnAt !== b.kilnAt) return a.kilnAt - b.kilnAt;
  if (a.mist !== b.mist) return a.mist - b.mist;
  return a.seq - b.seq;
}

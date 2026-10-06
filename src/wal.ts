import { TrustRollError } from "./errors";
import { CoordinatorSnapshot, JournalEntry } from "./types";
import { deepClone } from "./util";

export class Wal {
  private entries: JournalEntry[] = [];

  constructor(private readonly limit: number | undefined) {}

  get length(): number {
    return this.entries.length;
  }

  ensureCapacity(): void {
    if (this.limit !== undefined && this.entries.length + 1 > this.limit) {
      throw new TrustRollError("CAPACITY_WAL", "write-ahead log capacity reached");
    }
  }

  append(at: number, type: string, payload: unknown, state: CoordinatorSnapshot): void {
    this.entries.push({
      seq: this.entries.length + 1,
      at,
      type,
      payload: deepClone(payload),
      state: deepClone(state),
    });
  }

  list(): JournalEntry[] {
    return deepClone(this.entries);
  }

  restore(entries: JournalEntry[]): void {
    this.entries = deepClone(entries);
  }
}

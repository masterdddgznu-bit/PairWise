import { JournalEntry, StateSnapshot, WalPayload } from "./types";
import { deepCopy } from "./util";

export class Wal {
  private entries: JournalEntry[] = [];

  get length(): number {
    return this.entries.length;
  }

  append(at: number, payload: WalPayload, state: StateSnapshot): void {
    this.entries.push({
      seq: this.entries.length + 1,
      at,
      payload: deepCopy(payload),
      state: deepCopy(state),
    });
  }

  list(): JournalEntry[] {
    return deepCopy(this.entries);
  }

  load(entries: JournalEntry[]): void {
    this.entries = deepCopy(entries);
  }
}

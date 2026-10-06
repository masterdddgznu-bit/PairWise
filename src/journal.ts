import { StateError } from "./errors.js";
import type { WalEntry, WalRecord } from "./types.js";

export class Journal {
  private readonly entries: WalEntry[] = [];

  get length(): number {
    return this.entries.length;
  }

  record(payload: WalRecord): WalEntry {
    const entry = { seq: this.entries.length + 1, ...structuredClone(payload) } as WalEntry;
    this.entries.push(entry);
    return structuredClone(entry);
  }

  appendReplayed(entry: WalEntry): void {
    if (entry.seq !== this.entries.length + 1) {
      throw new StateError(`journal sequence gap at seq ${entry.seq}`);
    }
    this.entries.push(structuredClone(entry));
  }

  snapshot(): WalEntry[] {
    return structuredClone(this.entries);
  }
}

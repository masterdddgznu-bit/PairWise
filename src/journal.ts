import { deepCopy } from "./util";

export type JournalEntryType =
  | "init"
  | "create"
  | "loss"
  | "plan"
  | "claim"
  | "complete"
  | "open"
  | "close"
  | "drive";

export interface JournalEntry {
  seq: number;
  at: number;
  type: JournalEntryType;
  data: unknown;
}

export class Journal {
  private entries: JournalEntry[] = [];

  append(at: number, type: JournalEntryType, data: unknown): void {
    this.entries.push({
      seq: this.entries.length + 1,
      at,
      type,
      data: deepCopy(data),
    });
  }

  list(): JournalEntry[] {
    return deepCopy(this.entries);
  }
}

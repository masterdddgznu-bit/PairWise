import type { JournalEntry } from "./types.js";

/** Append-only coordinator journal — stub. */
export class Journal {
  private log: JournalEntry[] = [];

  append(_e: JournalEntry): void {
    /* stub */
  }

  entries(): readonly JournalEntry[] {
    return this.log;
  }

  clear(): void {
    this.log = [];
  }
}

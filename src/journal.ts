import type { JournalEntry } from "./types.js";

/** Append-only coordinator journal — stub. */
export class Journal {
  private log: JournalEntry[] = [];

  append(e: JournalEntry): void {
    this.log.push(e);
  }

  entries(): readonly JournalEntry[] {
    return this.log;
  }

  clear(): void {
    this.log = [];
  }
}

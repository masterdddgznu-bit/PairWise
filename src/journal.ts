import type { JournalEntry } from "./types.js";

type EntryInput = JournalEntry extends infer E ? E extends JournalEntry ? Omit<E, "seq"> : never : never;

export class Journal {
  private rows: JournalEntry[] = [];

  append(entry: EntryInput): JournalEntry {
    const row = { ...entry, seq: this.rows.length + 1 } as JournalEntry;
    this.rows.push(row);
    return { ...row };
  }

  all(sagaId?: string): JournalEntry[] {
    if (sagaId === undefined) return this.rows;
    return this.rows.filter((entry) => entry.sagaId === sagaId);
  }

  restore(rows: JournalEntry[]): void {
    this.rows = rows;
  }
}

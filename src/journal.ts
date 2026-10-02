import type { JournalEntry } from "./types.js";

type EntryInput = JournalEntry extends infer E ? E extends JournalEntry ? Omit<E, "seq"> : never : never;

export class Journal {
  private rows: JournalEntry[] = [];

  append(entry: EntryInput): JournalEntry {
    const row = structuredClone({ ...entry, seq: this.rows.length + 1 }) as JournalEntry;
    this.rows.push(row);
    return structuredClone(row);
  }

  all(sagaId?: string): JournalEntry[] {
    const rows = sagaId === undefined ? this.rows : this.rows.filter((entry) => entry.sagaId === sagaId);
    return structuredClone(rows);
  }

  restore(rows: JournalEntry[]): void {
    this.rows = structuredClone(rows);
  }
}

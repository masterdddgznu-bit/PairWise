import { deepClone } from "./clone";
import { fail } from "./errors";

export interface JournalEntry {
  seq: number;
  type: string;
  data: unknown;
}

export class Journal {
  private entries: JournalEntry[] = [];

  append(type: string, data: unknown): JournalEntry {
    const entry: JournalEntry = {
      seq: this.entries.length + 1,
      type,
      data: deepClone(data),
    };
    this.entries.push(entry);
    return entry;
  }

  snapshot(): JournalEntry[] {
    return deepClone(this.entries);
  }

  load(entries: JournalEntry[]): void {
    this.entries = deepClone(entries);
  }

  get length(): number {
    return this.entries.length;
  }

  static validate(raw: unknown): JournalEntry[] {
    if (!Array.isArray(raw)) {
      fail("JOURNAL_INVALID", "journal must be an array");
    }
    const entries = deepClone(raw) as JournalEntry[];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (
        entry === null ||
        typeof entry !== "object" ||
        typeof entry.type !== "string" ||
        typeof entry.seq !== "number" ||
        !("data" in entry)
      ) {
        fail("JOURNAL_INVALID", "journal entry is malformed");
      }
      if (entry.seq !== i + 1) {
        fail("JOURNAL_SEQUENCE", "journal sequence mismatch");
      }
    }
    return entries;
  }
}

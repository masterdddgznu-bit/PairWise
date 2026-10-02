import type { VersionEntry } from "./types.js";
import type { CommittedStore } from "./store.js";

export type JournalRow = { key: string; entry: VersionEntry };

/** Append-only commit journal for recovery. */
export class Journal {
  private entries: JournalRow[] = [];

  append(key: string, entry: VersionEntry): void {
    this.entries.push({ key, entry });
  }

  replay(store: CommittedStore): void {
    for (const { key, entry } of this.entries) {
      store.put(key, entry);
    }
  }

  snapshot(): JournalRow[] {
    return this.entries.map((e) => ({ key: e.key, entry: { ...e.entry } }));
  }

  restore(rows: JournalRow[]): void {
    this.entries = rows.map((row) => ({
      key: row.key,
      entry: { ...row.entry },
    }));
  }
}

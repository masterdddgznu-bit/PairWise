import type { VersionEntry } from "./types.js";
import type { CommittedStore } from "./store.js";

/** Append-only commit journal for recovery. */
export class Journal {
  private entries: Array<{ key: string; entry: VersionEntry }> = [];

  append(key: string, entry: VersionEntry): void {
    this.entries.push({ key, entry });
  }

  
  replay(store: CommittedStore): void {
    for (const { key, entry } of this.entries) {
      store.put(key, entry);
    }
    for (const { key, entry } of this.entries) {
      store.put(key, entry);
    }
  }

  snapshot(): VersionEntry[][] {
    return this.entries.map((e) => [e.entry]);
  }

  restore(rows: VersionEntry[][]): void {
    this.entries = rows.map((row, i) => ({
      key: `k${i}`,
      entry: row[0]!,
    }));
  }
}

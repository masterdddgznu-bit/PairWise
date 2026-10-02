import type { JournalEntry } from "./types.js";
import type { ShardStore } from "./shard.js";

export class Journal {
  private entries: JournalEntry[] = [];
  private committed = new Set<string>();

  append(entry: JournalEntry): void {
    this.entries.push(entry);
    if (entry.kind === "commit") {
      this.committed.add(entry.txnId);
    }
  }

  all(): JournalEntry[] {
    return [...this.entries];
  }

  replace(entries: JournalEntry[]): void {
    this.entries = [...entries];
    this.committed.clear();
    for (const e of this.entries) {
      if (e.kind === "commit") this.committed.add(e.txnId);
    }
  }

  replayCommit(
    entry: Extract<JournalEntry, { kind: "commit" }>,
    writes: Record<string, string>,
    shards: ShardStore[],
    route: (key: string) => number,
  ): void {
    if (this.committed.has(entry.txnId)) return;
    for (const [key, value] of Object.entries(writes)) {
      const sid = route(key);
      shards[sid]?.put(key, value);
    }
    this.committed.add(entry.txnId);
  }
}

import type { JournalEntry } from "./types.js";
import type { ShardStore } from "./shard.js";

export class Journal {
  private entries: JournalEntry[] = [];

  append(entry: JournalEntry): void {
    this.entries.push(entry);
  }

  all(): JournalEntry[] {
    return [...this.entries];
  }

  replace(entries: JournalEntry[]): void {
    this.entries = [...entries];
  }

  /** BUG: replay always re-applies commit writes (no idempotency guard). */
  replayCommit(
    entry: Extract<JournalEntry, { kind: "commit" }>,
    writes: Record<string, string>,
    shards: ShardStore[],
    route: (key: string) => number,
  ): void {
    for (const [key, value] of Object.entries(writes)) {
      const sid = route(key);
      shards[sid]?.put(key, value);
    }
  }
}

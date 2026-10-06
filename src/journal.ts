export type JournalEntry =
  | { type: "register"; participant: string }
  | { type: "unregister"; participant: string }
  | { type: "begin"; txId: number; members: string[]; deadline: number }
  | { type: "prepare"; txId: number; participant: string; vote: boolean }
  | { type: "commit"; txId: number }
  | { type: "abort"; txId: number; reason: "expire" | "explicit" | "no-vote" };

function cloneEntry(entry: JournalEntry): JournalEntry {
  if (entry.type === "begin") {
    return { ...entry, members: [...entry.members] };
  }
  return { ...entry };
}

export class Wal {
  private entries: JournalEntry[] = [];

  append(entry: JournalEntry): void {
    this.entries.push(cloneEntry(entry));
  }

  snapshot(): JournalEntry[] {
    return this.entries.map(cloneEntry);
  }
}

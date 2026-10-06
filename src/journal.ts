export type AbortReason = "expire" | "explicit" | "no-vote";

export type JournalEntry =
  | { type: "register"; participant: string }
  | { type: "unregister"; participant: string }
  | { type: "begin"; txId: number; members: string[]; deadline: number }
  | { type: "prepare"; txId: number; participant: string; vote: boolean }
  | { type: "commit"; txId: number }
  | { type: "abort"; txId: number; reason: AbortReason };

export function cloneEntry(entry: JournalEntry): JournalEntry {
  if (entry.type === "begin") {
    return { ...entry, members: [...entry.members] };
  }
  return { ...entry };
}

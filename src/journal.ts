import { deepClone } from "./clone";
import { fail } from "./errors";

export type AbortReason = "rejected" | "expired";

export type JournalData =
  | { type: "subject-registered"; subject: string; schema: unknown }
  | { type: "version-added"; subject: string; version: number; schema: unknown; compatibleWith: number[] }
  | { type: "version-retired"; subject: string; version: number }
  | { type: "consumer-registered"; consumer: string }
  | { type: "rollout-began"; id: string; subject: string; target: number; members: string[]; beganAt: number }
  | { type: "ack"; id: string; consumer: string; accept: boolean }
  | { type: "rollout-committed"; id: string }
  | { type: "rollout-aborted"; id: string; reason: AbortReason };

export interface JournalEntry {
  seq: number;
  data: JournalData;
}

const KNOWN_TYPES = new Set([
  "subject-registered",
  "version-added",
  "version-retired",
  "consumer-registered",
  "rollout-began",
  "ack",
  "rollout-committed",
  "rollout-aborted",
]);

export class Wal {
  private entries: JournalEntry[] = [];

  append(data: JournalData): JournalEntry {
    const entry: JournalEntry = { seq: this.entries.length + 1, data: deepClone(data) };
    this.entries.push(entry);
    return deepClone(entry);
  }

  get length(): number {
    return this.entries.length;
  }

  snapshot(): JournalEntry[] {
    return deepClone(this.entries);
  }

  static validate(raw: unknown): JournalEntry[] {
    if (!Array.isArray(raw)) {
      fail("JOURNAL_ENTRY", "journal must be an array of entries");
    }
    const entries = raw as JournalEntry[];
    for (let i = 0; i < entries.length; i += 1) {
      const entry = entries[i];
      if (
        entry === null ||
        typeof entry !== "object" ||
        typeof entry.seq !== "number" ||
        entry.data === null ||
        typeof entry.data !== "object" ||
        !KNOWN_TYPES.has((entry.data as { type?: unknown }).type as string)
      ) {
        fail("JOURNAL_ENTRY", `journal entry at index ${i} is malformed`);
      }
      if (entry.seq !== i + 1) {
        fail("JOURNAL_SEQUENCE", `journal entry at index ${i} has seq ${entry.seq}, expected ${i + 1}`);
      }
    }
    return deepClone(entries);
  }
}

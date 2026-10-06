import { EscrowError } from "./errors";
import type { JournalEntry, JournalKind } from "./types";

const KNOWN_KINDS: ReadonlySet<string> = new Set<JournalKind>([
  "tenant.added",
  "transfer.prepared",
  "transfer.accepted",
  "transfer.cancelled",
  "reservation.reserved",
  "reservation.committed",
  "reservation.released",
  "reservation.expired",
]);

export function appendEntry(journal: JournalEntry[], kind: JournalKind, at: number, data: Record<string, unknown>): void {
  journal.push({ seq: journal.length + 1, at, kind, data });
}

export function snapshot(journal: JournalEntry[]): JournalEntry[] {
  return structuredClone(journal);
}

export function validateEntry(raw: unknown, expectedSeq: number, recoveryNow: number): JournalEntry {
  if (typeof raw !== "object" || raw === null) {
    throw new EscrowError("JOURNAL_INVALID", "journal entry must be an object");
  }
  const entry = raw as JournalEntry;
  if (entry.seq !== expectedSeq) {
    throw new EscrowError("JOURNAL_GAP", `expected seq ${expectedSeq} but found ${String(entry.seq)}`);
  }
  if (typeof entry.at !== "number" || !Number.isSafeInteger(entry.at) || entry.at < 0) {
    throw new EscrowError("JOURNAL_INVALID", `invalid journal timestamp ${String(entry.at)}`);
  }
  if (entry.at > recoveryNow) {
    throw new EscrowError("FUTURE_JOURNAL", `entry at ${entry.at} is after recovery time ${recoveryNow}`);
  }
  if (!KNOWN_KINDS.has(entry.kind)) {
    throw new EscrowError("JOURNAL_INVALID", `unknown journal kind ${String(entry.kind)}`);
  }
  if (typeof entry.data !== "object" || entry.data === null || Array.isArray(entry.data)) {
    throw new EscrowError("JOURNAL_INVALID", "journal data must be an object");
  }
  return structuredClone(entry);
}

import { deepCopy } from "./clone";
import { JournalEntry } from "./types";

export class Journal {
  private entries: JournalEntry[] = [];

  get length(): number {
    return this.entries.length;
  }

  nextSeq(): number {
    return this.entries.length + 1;
  }

  push(entry: JournalEntry): void {
    this.entries.push(deepCopy(entry));
  }

  reset(): void {
    this.entries = [];
  }

  list(): JournalEntry[] {
    return deepCopy(this.entries);
  }
}

export function validateFrame(entries: JournalEntry[], now: number): void {
  let previous = Number.NEGATIVE_INFINITY;
  entries.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new Error(`journal corrupt: entry at index ${index} is not an object`);
    }
    if (entry.seq !== index + 1) {
      throw new Error(`journal gap: expected seq ${index + 1}, found ${entry.seq}`);
    }
    if (
      typeof entry.at !== "number" ||
      !Number.isFinite(entry.at) ||
      entry.at < previous ||
      entry.at > now
    ) {
      throw new Error(`journal time: entry seq ${entry.seq} at ${entry.at} is out of order or in the future`);
    }
    previous = entry.at;
  });
}

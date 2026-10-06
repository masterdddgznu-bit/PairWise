import { JournalEntry, JournalKind } from "./types";

export class Journal {
  private readonly entries: JournalEntry[] = [];
  private suspended = false;

  append(kind: JournalKind, at: number, data: Record<string, unknown>): void {
    if (this.suspended) {
      return;
    }
    this.entries.push({
      seq: this.entries.length + 1,
      at,
      kind,
      data: structuredClone(data),
    });
  }

  appendRecovered(entry: JournalEntry): void {
    this.entries.push(structuredClone(entry));
  }

  suspend(): void {
    this.suspended = true;
  }

  resume(): void {
    this.suspended = false;
  }

  list(): JournalEntry[] {
    return structuredClone(this.entries);
  }

  get length(): number {
    return this.entries.length;
  }
}

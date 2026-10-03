import type { LogEntry } from "./types.js";

export class EntryLog {
  private byIndex = new Map<number, LogEntry>();
  private last = 0;

  append(e: LogEntry): void {
    this.byIndex.set(e.index, e);
    if (e.index > this.last) this.last = e.index;
  }

  get(index: number): LogEntry | undefined {
    return this.byIndex.get(index);
  }

  has(index: number): boolean {
    return this.byIndex.has(index);
  }

  lastIndex(): number {
    return this.last;
  }

  truncateAfter(index: number): void {
    this.truncateFrom(index + 1);
  }

  truncateFrom(index: number): void {
    for (const i of [...this.byIndex.keys()]) {
      if (i >= index) this.byIndex.delete(i);
    }
    if (this.last >= index) this.last = index - 1;
    if (this.last < 0) this.last = 0;
  }

  entries(): LogEntry[] {
    return [...this.byIndex.values()].sort((a, b) => a.index - b.index);
  }

  restore(entries: LogEntry[], lastIndex: number): void {
    this.byIndex = new Map(entries.map((e) => [e.index, { ...e }]));
    this.last = lastIndex;
  }
}

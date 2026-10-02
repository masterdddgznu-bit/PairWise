import type { LogEntry } from "./types.js";
import { makeEntry } from "./entry.js";

export class Replica {
  private log: LogEntry[] = [];

  constructor(public readonly id: number) {}

  lastIndex(): number {
    return this.log.length;
  }

  appendAt(index: number, payload: string): void {
    if (index !== this.log.length + 1) return;
    this.log.push(makeEntry(index, payload));
  }

  read(index: number): string | undefined {
    const e = this.log[index - 1];
    return e?.payload;
  }

  has(index: number): boolean {
    const e = this.log[index - 1];
    return e !== undefined && e.index === index;
  }

  truncateAfter(index: number): void {
    if (index < 0) return;
    this.log = this.log.slice(0, index);
  }

  snapshot(): LogEntry[] {
    return this.log.map((e) => ({ ...e }));
  }

  restore(entries: LogEntry[]): void {
    this.log = entries.map((e) => ({ ...e }));
  }
}

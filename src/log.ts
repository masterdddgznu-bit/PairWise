import type { LogEntry } from "./types.js";

export class EntryLog {
  append(_e: LogEntry): void {}
  get(_index: number): LogEntry | undefined {
    return undefined;
  }
  lastIndex(): number {
    return 0;
  }
  truncateAfter(_index: number): void {}
  truncateFrom(_index: number): void {}
  entries(): LogEntry[] {
    return [];
  }
}

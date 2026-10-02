import type { LogEntry } from "./types.js";

export function makeEntry(index: number, payload: string): LogEntry {
  return { index, payload };
}

export function entryAt(log: LogEntry[], index: number): LogEntry | undefined {
  if (index < 1 || index > log.length) return undefined;
  return log[index - 1];
}

export function lastIndexFromLog(log: LogEntry[]): number {
  return log.length;
}

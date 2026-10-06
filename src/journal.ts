import type { WalEntry, WalPayload } from "./types.js";

export function deepCopy<T>(value: T): T {
  return structuredClone(value);
}

export function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (typeof left !== "object" || typeof right !== "object" || left === null || right === null) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
    return left.every((item, index) => deepEqual(item, right[index]));
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every(
    (key) =>
      Object.prototype.hasOwnProperty.call(right, key) &&
      deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]),
  );
}

export class Journal {
  private entries: WalEntry[] = [];

  append(at: number, payload: WalPayload): WalEntry {
    const entry = { seq: this.entries.length + 1, at, ...payload } as WalEntry;
    this.entries.push(entry);
    return entry;
  }

  get length(): number {
    return this.entries.length;
  }

  last(): WalEntry | undefined {
    return this.entries[this.entries.length - 1];
  }

  list(): WalEntry[] {
    return this.entries.map((entry) => deepCopy(entry));
  }
}

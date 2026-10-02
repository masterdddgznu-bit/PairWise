import type { KVEntry } from "./types.js";

export class Replica {
  constructor(public readonly id: number) {}

  private data = new Map<string, KVEntry>();

  get(key: string): KVEntry | undefined {
    const e = this.data.get(key);
    return e ? { ...e } : undefined;
  }

  put(key: string, entry: KVEntry): void {
    this.data.set(key, { ...entry });
  }

  deleteKey(key: string): void {
    this.data.delete(key);
  }

  snapshot(): Record<string, KVEntry> {
    const out: Record<string, KVEntry> = {};
    for (const [k, v] of this.data) out[k] = { ...v };
    return out;
  }

  restore(raw: Record<string, KVEntry>): void {
    this.data.clear();
    for (const [k, v] of Object.entries(raw)) {
      this.data.set(k, { ...v });
    }
  }
}

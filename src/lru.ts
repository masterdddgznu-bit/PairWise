import type { Entry } from "./types.js";

export class LruLayer {
  private readonly map = new Map<string, Entry>();

  constructor(readonly capacity: number) {}

  size(): number {
    return this.map.size;
  }

  keys(): string[] {
    return [...this.map.keys()].sort();
  }

  get(key: string): Entry | undefined {
    const e = this.map.get(key);
    if (!e) return undefined;
    this.map.delete(key);
    this.map.set(key, e);
    return e;
  }

  peek(key: string): Entry | undefined {
    return this.map.get(key);
  }

  /** Returns evicted [key, entry] if capacity exceeded. */
  set(key: string, entry: Entry): [string, Entry] | null {
    if (this.map.has(key)) this.map.delete(key);
    this.map.set(key, entry);
    if (this.map.size <= this.capacity) return null;
    const oldestKey = this.map.keys().next().value as string;
    const oldest = this.map.get(oldestKey)!;
    this.map.delete(oldestKey);
    return [oldestKey, oldest];
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  entries(): Array<[string, Entry]> {
    return [...this.map.entries()];
  }
}

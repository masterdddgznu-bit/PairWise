import type { Entry } from "./types.js";

/** Key → entry map. */
export class EntryStore {
  private readonly map = new Map<string, Entry>();

  get(key: string): Entry | undefined {
    return this.map.get(key);
  }

  set(entry: Entry): void {
    this.map.set(entry.key, entry);
  }

  delete(key: string): boolean {
    return this.map.delete(key);
  }

  values(): Entry[] {
    return [...this.map.values()];
  }

  size(): number {
    return this.map.size;
  }
}

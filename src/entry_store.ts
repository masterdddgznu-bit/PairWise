import type { Entry } from "./types.js";

/** Key → entry map. */
export class EntryStore {
  private readonly map = new Map<string, Entry>();

  get(_key: string): Entry | undefined {
    return this.map.get(_key);
  }

  set(_entry: Entry): void {
    this.map.set(_entry.key, _entry);
  }

  delete(_key: string): boolean {
    return this.map.delete(_key);
  }

  values(): Entry[] {
    return [...this.map.values()];
  }

  size(): number {
    return this.map.size;
  }
}

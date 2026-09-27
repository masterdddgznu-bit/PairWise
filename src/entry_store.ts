import type { Entry } from "./types.js";

/** Key → entry map — stub. */
export class EntryStore {
  get(_key: string): Entry | undefined {
    return undefined;
  }

  set(_entry: Entry): void {
    /* stub */
  }

  delete(_key: string): boolean {
    return false;
  }

  values(): Entry[] {
    return [];
  }

  size(): number {
    return 0;
  }
}

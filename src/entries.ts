import type { Dot, Entry } from "./types.js";

export class EntryStore {
  put(_key: string, _value: string, _dot: Dot): void {
    throw new Error("entries put not implemented");
  }

  tombstone(_key: string, _dot: Dot): boolean {
    throw new Error("tombstone not implemented");
  }

  getValue(_key: string): string | undefined {
    throw new Error("getValue not implemented");
  }

  getEntry(_key: string): Entry | undefined {
    throw new Error("getEntry not implemented");
  }

  keys(): string[] {
    return [];
  }

  size(): number {
    return 0;
  }

  all(): Entry[] {
    return [];
  }

  applyLww(_e: Entry): void {
    throw new Error("applyLww not implemented");
  }

  removeTombstones(_pred: (e: Entry) => boolean): number {
    throw new Error("removeTombstones not implemented");
  }
}

import type { Atom, Dot } from "./types.js";

export class AtomStore {
  insertAfter(_after: Dot | null, _ch: string, _id: Dot): void {
    throw new Error("insertAfter not implemented");
  }

  tombstone(_id: Dot): boolean {
    throw new Error("tombstone not implemented");
  }

  get(_id: Dot): Atom | undefined {
    throw new Error("get not implemented");
  }

  all(): Atom[] {
    return [];
  }

  mergeFrom(_other: AtomStore): void {
    throw new Error("mergeFrom not implemented");
  }

  gcTombstones(_pred: (id: Dot) => boolean): number {
    throw new Error("gcTombstones not implemented");
  }
}

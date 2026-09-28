import type { Dot, TagView } from "./types.js";

export class TagStore {
  addTag(_elem: string, _dot: Dot): void {
    throw new Error("addTag not implemented");
  }

  tombstoneAllLive(_elem: string): boolean {
    throw new Error("tombstoneAllLive not implemented");
  }

  has(_elem: string): boolean {
    throw new Error("has not implemented");
  }

  values(): string[] {
    return [];
  }

  size(): number {
    return 0;
  }

  getTags(_elem: string): TagView {
    throw new Error("getTags not implemented");
  }

  mergeFrom(_other: TagStore): void {
    throw new Error("mergeFrom not implemented");
  }

  allTagged(): { elem: string; live: Dot[]; tomb: Dot[] }[] {
    return [];
  }

  gcTombstones(_pred: (dot: Dot) => boolean): number {
    throw new Error("gcTombstones not implemented");
  }
}

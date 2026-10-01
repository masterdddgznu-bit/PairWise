import { SkipError } from "./errors.js";
import type { SkipListState, SkipStats } from "./types.js";

/** Deterministic skip list ordered map — starter stub. */
export class SkipList {
  constructor(_maxLevel: number, _seed: number, _p?: number) {
    /* params accepted; methods throw until implemented */
  }

  set(_key: string, _value: number): void {
    throw new Error("set not implemented");
  }

  get(_key: string): number | undefined {
    throw new Error("get not implemented");
  }

  has(_key: string): boolean {
    throw new Error("has not implemented");
  }

  delete(_key: string): boolean {
    throw new Error("delete not implemented");
  }

  size(): number {
    throw new Error("size not implemented");
  }

  range(_minKey: string, _maxKey: string): { key: string; value: number }[] {
    throw new Error("range not implemented");
  }

  keys(): string[] {
    throw new Error("keys not implemented");
  }

  toArray(): { key: string; value: number }[] {
    throw new Error("toArray not implemented");
  }

  exportState(): SkipListState {
    throw new Error("exportState not implemented");
  }

  static fromState(_state: SkipListState): SkipList {
    throw new Error("fromState not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): SkipStats {
    throw new Error("stats not implemented");
  }
}

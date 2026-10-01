import type { TreapState, TreapStats } from "./types.js";

/** Deterministic treap ordered map — starter stub. */
export class Treap {
  constructor(_seed: number) {
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

  keys(): string[] {
    throw new Error("keys not implemented");
  }

  toArray(): { key: string; value: number; priority: number }[] {
    throw new Error("toArray not implemented");
  }

  split(_key: string): { left: Treap; right: Treap } {
    throw new Error("split not implemented");
  }

  static merge(_left: Treap, _right: Treap): Treap {
    throw new Error("merge not implemented");
  }

  exportState(): TreapState {
    throw new Error("exportState not implemented");
  }

  static fromState(_state: TreapState): Treap {
    throw new Error("fromState not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): TreapStats {
    throw new Error("stats not implemented");
  }
}

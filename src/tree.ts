import type { RbStats, RbTreeState } from "./types.js";

/** Deterministic Red-Black ordered map — starter stub. */
export class RbTree {
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

  height(): number {
    throw new Error("height not implemented");
  }

  blackHeight(): number {
    throw new Error("blackHeight not implemented");
  }

  keys(): string[] {
    throw new Error("keys not implemented");
  }

  range(_lo: string, _hi: string): { key: string; value: number }[] {
    throw new Error("range not implemented");
  }

  exportState(): RbTreeState {
    throw new Error("exportState not implemented");
  }

  static fromState(_state: RbTreeState): RbTree {
    throw new Error("fromState not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): RbStats {
    throw new Error("stats not implemented");
  }
}

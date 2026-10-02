import type { FibHeapState, FibStats } from "./types.js";

/** Deterministic Fibonacci min-heap — starter stub. */
export class FibHeap {
  insert(_key: string, _priority: number): number {
    throw new Error("insert not implemented");
  }

  findMin(): { id: number; key: string; priority: number } | undefined {
    throw new Error("findMin not implemented");
  }

  extractMin(): { id: number; key: string; priority: number } | undefined {
    throw new Error("extractMin not implemented");
  }

  decreaseKey(_id: number, _newPriority: number): void {
    throw new Error("decreaseKey not implemented");
  }

  delete(_id: number): boolean {
    throw new Error("delete not implemented");
  }

  meld(_other: FibHeap): void {
    throw new Error("meld not implemented");
  }

  size(): number {
    throw new Error("size not implemented");
  }

  isEmpty(): boolean {
    throw new Error("isEmpty not implemented");
  }

  exportState(): FibHeapState {
    throw new Error("exportState not implemented");
  }

  static fromState(_state: FibHeapState): FibHeap {
    throw new Error("fromState not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): FibStats {
    throw new Error("stats not implemented");
  }
}

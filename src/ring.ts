import { RingError } from "./errors.js";
import type { ConsistentRingState, RingEntry, RingStats } from "./types.js";

/** Consistent hashing ring with virtual nodes — starter stub. */
export class ConsistentRing {
  constructor(_vnodeCount: number, _seed: number) {
    /* params accepted; methods throw until implemented */
  }

  addNode(_id: string): void {
    throw new Error("addNode not implemented");
  }

  removeNode(_id: string): void {
    throw new Error("removeNode not implemented");
  }

  nodes(): string[] {
    throw new Error("nodes not implemented");
  }

  assign(_key: string): string | null {
    throw new Error("assign not implemented");
  }

  successors(_key: string, _k: number): string[] {
    throw new Error("successors not implemented");
  }

  vnodePositions(_id: string): number[] {
    throw new Error("vnodePositions not implemented");
  }

  ringSnapshot(): RingEntry[] {
    throw new Error("ringSnapshot not implemented");
  }

  exportState(): ConsistentRingState {
    throw new Error("exportState not implemented");
  }

  static fromState(_state: ConsistentRingState): ConsistentRing {
    throw new Error("fromState not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): RingStats {
    throw new Error("stats not implemented");
  }
}

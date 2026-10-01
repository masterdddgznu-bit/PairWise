import { RendezvousError } from "./errors.js";
import type { NodeRecord, RendezvousStats } from "./types.js";

/** Rendezvous / HRW hashing — starter stub. */
export class RendezvousHash {
  constructor(_seed: number) {
    /* params accepted; methods throw until implemented */
  }

  addNode(_id: string, _weight = 1): void {
    throw new Error("addNode not implemented");
  }

  removeNode(_id: string): void {
    throw new Error("removeNode not implemented");
  }

  hasNode(_id: string): boolean {
    throw new Error("hasNode not implemented");
  }

  nodeWeight(_id: string): number {
    throw new Error("nodeWeight not implemented");
  }

  pick(_key: string): string | null {
    throw new Error("pick not implemented");
  }

  topK(_key: string, _k: number): string[] {
    throw new Error("topK not implemented");
  }

  exportNodes(): NodeRecord[] {
    throw new Error("exportNodes not implemented");
  }

  static fromNodes(_seed: number, _nodes: NodeRecord[]): RendezvousHash {
    throw new Error("fromNodes not implemented");
  }

  needsRebalance(_threshold: number): boolean {
    throw new Error("needsRebalance not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): RendezvousStats {
    throw new Error("stats not implemented");
  }
}

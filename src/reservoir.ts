import { ReservoirError } from "./errors.js";
import type { ReservoirState, ReservoirStats } from "./types.js";

/** Reservoir sampling — starter stub. */
export class Reservoir {
  constructor(_k: number, _seed: number) {
    /* params accepted; methods throw until implemented */
  }

  add(_item: string): void {
    throw new Error("add not implemented");
  }

  items(): string[] {
    throw new Error("items not implemented");
  }

  seen(): number {
    throw new Error("seen not implemented");
  }

  capacity(): number {
    throw new Error("capacity not implemented");
  }

  merge(_other: Reservoir): void {
    throw new Error("merge not implemented");
  }

  exportState(): ReservoirState {
    throw new Error("exportState not implemented");
  }

  static fromState(_state: ReservoirState): Reservoir {
    throw new Error("fromState not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): ReservoirStats {
    throw new Error("stats not implemented");
  }
}

import { JumpError } from "./errors.js";
import type { JumpState, JumpStats } from "./types.js";

/** Jump consistent hash — starter stub. */
export class JumpHash {
  constructor(_numBuckets: number, _seed: number) {
    /* params accepted; methods throw until implemented */
  }

  keyToUint64(_key: string): bigint {
    throw new Error("keyToUint64 not implemented");
  }

  assign(_key: string): number {
    throw new Error("assign not implemented");
  }

  setNumBuckets(_n: number): void {
    throw new Error("setNumBuckets not implemented");
  }

  numBuckets(): number {
    throw new Error("numBuckets not implemented");
  }

  seed(): number {
    throw new Error("seed not implemented");
  }

  assignMany(_keys: string[]): number[] {
    throw new Error("assignMany not implemented");
  }

  distribution(_keys: string[]): number[] {
    throw new Error("distribution not implemented");
  }

  movedKeys(_keys: string[], _newNumBuckets: number): string[] {
    throw new Error("movedKeys not implemented");
  }

  exportState(): JumpState {
    throw new Error("exportState not implemented");
  }

  static fromState(_state: JumpState): JumpHash {
    throw new Error("fromState not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): JumpStats {
    throw new Error("stats not implemented");
  }
}

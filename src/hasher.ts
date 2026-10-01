import { JumpError } from "./errors.js";
import { fnv1a32 } from "./hash.js";
import { jumpConsistentHash } from "./jump.js";
import type { JumpState, JumpStats } from "./types.js";

/** Jump consistent hash. */
export class JumpHash {
  private n: number;
  private readonly s: number;
  private frozen = false;

  constructor(numBuckets: number, seed: number) {
    if (!Number.isInteger(numBuckets) || numBuckets < 1) {
      throw new JumpError("invalid numBuckets");
    }
    this.n = numBuckets;
    this.s = seed >>> 0;
  }

  keyToUint64(key: string): bigint {
    const lo = fnv1a32(key, this.s);
    const hi = fnv1a32(key, (this.s + 1) >>> 0);
    return (BigInt(hi) << 32n) | BigInt(lo);
  }

  assign(key: string): number {
    return jumpConsistentHash(this.keyToUint64(key), this.n);
  }

  setNumBuckets(n: number): void {
    if (this.frozen) {
      throw new JumpError("frozen");
    }
    if (!Number.isInteger(n) || n < 1) {
      throw new JumpError("invalid numBuckets");
    }
    this.n = n;
  }

  numBuckets(): number {
    return this.n;
  }

  seed(): number {
    return this.s;
  }

  assignMany(keys: string[]): number[] {
    return keys.map((k) => this.assign(k));
  }

  distribution(keys: string[]): number[] {
    const dist = new Array<number>(this.n).fill(0);
    for (const k of keys) {
      dist[this.assign(k)] += 1;
    }
    return dist;
  }

  movedKeys(keys: string[], newNumBuckets: number): string[] {
    if (!Number.isInteger(newNumBuckets) || newNumBuckets < 1) {
      throw new JumpError("invalid numBuckets");
    }
    const moved: string[] = [];
    for (const k of keys) {
      if (
        jumpConsistentHash(this.keyToUint64(k), newNumBuckets) !==
        this.assign(k)
      ) {
        moved.push(k);
      }
    }
    return moved.sort();
  }

  exportState(): JumpState {
    return { numBuckets: this.n, seed: this.s };
  }

  static fromState(state: JumpState): JumpHash {
    return new JumpHash(state.numBuckets, state.seed);
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): JumpStats {
    return { numBuckets: this.n, seed: this.s, frozen: this.frozen };
  }
}

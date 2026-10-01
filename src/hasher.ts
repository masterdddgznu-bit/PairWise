import { JumpError } from "./errors.js";
import { fnv1a32 } from "./hash.js";
import { jumpConsistentHash } from "./jump.js";
import type { JumpState, JumpStats } from "./types.js";

/** Jump consistent hash hasher. */
export class JumpHash {
  private n: number;
  private readonly seedValue: number;
  private frozen = false;

  constructor(numBuckets: number, seed: number) {
    if (!Number.isInteger(numBuckets) || numBuckets < 1) {
      throw new JumpError("invalid numBuckets");
    }
    this.n = numBuckets;
    this.seedValue = seed;
  }

  keyToUint64(key: string): bigint {
    const lo = fnv1a32(key, this.seedValue);
    const hi = fnv1a32(key, (this.seedValue + 1) >>> 0);
    return (BigInt(hi) << 32n) | BigInt(lo);
  }

  assign(key: string): number {
    return jumpConsistentHash(this.keyToUint64(key), this.n);
  }

  setNumBuckets(n: number): void {
    if (this.frozen) {
      throw new JumpError("hasher is frozen");
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
    return this.seedValue;
  }

  assignMany(keys: string[]): number[] {
    return keys.map((key) => this.assign(key));
  }

  distribution(keys: string[]): number[] {
    const counts = new Array<number>(this.n).fill(0);
    for (const key of keys) {
      counts[this.assign(key)] += 1;
    }
    return counts;
  }

  movedKeys(keys: string[], newNumBuckets: number): string[] {
    if (!Number.isInteger(newNumBuckets) || newNumBuckets < 1) {
      throw new JumpError("invalid numBuckets");
    }
    const moved: string[] = [];
    for (const key of keys) {
      const before = jumpConsistentHash(this.keyToUint64(key), this.n);
      const after = jumpConsistentHash(this.keyToUint64(key), newNumBuckets);
      if (before !== after) {
        moved.push(key);
      }
    }
    return moved.sort();
  }

  exportState(): JumpState {
    return { numBuckets: this.n, seed: this.seedValue };
  }

  static fromState(state: JumpState): JumpHash {
    return new JumpHash(state.numBuckets, state.seed);
  }

  freeze(): void {
    this.frozen = true;
  }

  stats(): JumpStats {
    return { numBuckets: this.n, seed: this.seedValue, frozen: this.frozen };
  }
}

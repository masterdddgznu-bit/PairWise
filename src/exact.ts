import { fnv1a32 } from "./hash.js";
import { ExactError } from "./errors.js";

/** FNV mod-n exact buckets (base mode). */
export class ExactBuckets {
  private n: number;
  private readonly initialN: number;

  constructor(n: number) {
    if (!Number.isInteger(n) || n < 1) {
      throw new ExactError("invalid numBuckets");
    }
    this.n = n;
    this.initialN = n;
  }

  setNumBuckets(n: number): void {
    if (!Number.isInteger(n) || n < 1) {
      throw new ExactError("invalid numBuckets");
    }
    this.n = n;
  }

  numBuckets(): number {
    return this.n;
  }

  assignExact(key: string): number {
    return fnv1a32(key, 0) % this.n;
  }

  clear(): void {
    this.n = this.initialN;
  }
}

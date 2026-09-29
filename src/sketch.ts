import { BloomError } from "./errors.js";
import { fnv1a32 } from "./hash.js";

const BUCKET_SEED = 0x534b;

type Bucket = {
  count: number;
  keyHashXor: number;
};

/** IBLT-lite: per-bucket count plus XOR of key hashes (one hash per key). */
export class Sketch {
  readonly bucketCount: number;
  private readonly bucketData: Bucket[];

  constructor(buckets: number) {
    if (!Number.isInteger(buckets) || buckets <= 0) {
      throw new BloomError("buckets must be a positive integer");
    }
    this.bucketCount = buckets;
    this.bucketData = Array.from({ length: buckets }, () => ({
      count: 0,
      keyHashXor: 0,
    }));
  }

  private bucketIndex(key: string): number {
    return fnv1a32(key, BUCKET_SEED) % this.bucketCount;
  }

  add(key: string): void {
    const bucket = this.bucketData[this.bucketIndex(key)];
    bucket.keyHashXor = (bucket.keyHashXor ^ fnv1a32(key)) >>> 0;
    bucket.count++;
  }

  static fromKeys(keys: string[], buckets: number): Sketch {
    const sketch = new Sketch(buckets);
    for (const key of keys) sketch.add(key);
    return sketch;
  }

  /**
   * Decode the difference between this sketch and `other`. Decodable when each
   * bucket holds at most one key of difference: a count delta of +/-1 whose
   * XOR delta matches a candidate key's FNV hash recovers that key name.
   */
  diff(other: Sketch, candidates: string[] = []): string[] {
    if (other.bucketCount !== this.bucketCount) {
      throw new BloomError("diff requires sketches with matching bucket counts");
    }

    const candidatesByHash = new Map<number, string[]>();
    for (const key of candidates) {
      const hash = fnv1a32(key);
      const group = candidatesByHash.get(hash);
      if (group) group.push(key);
      else candidatesByHash.set(hash, [key]);
    }

    const recovered = new Set<string>();
    for (let i = 0; i < this.bucketCount; i++) {
      const local = this.bucketData[i];
      const remote = other.bucketData[i];
      const countDelta = local.count - remote.count;
      const xorDelta = (local.keyHashXor ^ remote.keyHashXor) >>> 0;

      if (countDelta === 0 && xorDelta === 0) continue;
      if (Math.abs(countDelta) !== 1 || xorDelta === 0) continue;

      const matches = candidatesByHash.get(xorDelta);
      if (!matches) continue;
      for (const key of matches) {
        if (this.bucketIndex(key) === i) recovered.add(key);
      }
    }

    return [...recovered].sort();
  }
}

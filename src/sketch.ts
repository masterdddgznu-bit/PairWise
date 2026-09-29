import { BloomError } from "./errors.js";
import { fnv1a32 } from "./hash.js";

const BUCKET_SEED = 0x534b;

type Bucket = { xor: number; count: number };

/** IBLT-lite sketch: per-bucket XOR of key hashes plus a count. */
export class Sketch {
  readonly buckets: number;
  private readonly cells: Bucket[];

  constructor(buckets: number) {
    if (!Number.isInteger(buckets) || buckets <= 0) {
      throw new BloomError("buckets must be a positive integer");
    }
    this.buckets = buckets;
    this.cells = [];
    for (let i = 0; i < buckets; i++) {
      this.cells.push({ xor: 0, count: 0 });
    }
  }

  add(key: string): void {
    const idx = fnv1a32(key, BUCKET_SEED) % this.buckets;
    const cell = this.cells[idx];
    cell.xor = (cell.xor ^ fnv1a32(key, 0)) >>> 0;
    cell.count += 1;
  }

  static fromKeys(keys: string[], buckets: number): Sketch {
    const sketch = new Sketch(buckets);
    for (const key of keys) {
      sketch.add(key);
    }
    return sketch;
  }

  /**
   * Decode keys present in exactly one of the two sketches, provided each
   * bucket holds at most one differing key. `candidates` maps the recovered
   * key-hash back to the key name.
   */
  diff(other: Sketch, candidates: string[] = []): string[] {
    if (other.buckets !== this.buckets) {
      throw new BloomError("diff requires matching bucket counts");
    }
    const byHash = new Map<number, string>();
    for (const key of candidates) {
      byHash.set(fnv1a32(key, 0), key);
    }
    const found = new Set<string>();
    for (let i = 0; i < this.buckets; i++) {
      const dCount = this.cells[i].count - other.cells[i].count;
      const dXor = (this.cells[i].xor ^ other.cells[i].xor) >>> 0;
      if (dCount === 0 && dXor === 0) continue;
      if (Math.abs(dCount) === 1 && dXor !== 0) {
        const key = byHash.get(dXor);
        if (key !== undefined) found.add(key);
      }
    }
    return [...found].sort();
  }
}

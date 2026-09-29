import { KeySet } from "./keyset.js";
import type { Summary } from "./types.js";
import { BloomFilter } from "./bloom.js";
import { Sketch } from "./sketch.js";
import { xorFingerprint } from "./hash.js";

/** Bloom-based replica: local KeySet plus summary / sketch reconciliation. */
export class Replica {
  readonly id: string;
  private readonly set = new KeySet();

  constructor(
    id: string,
    private readonly mBits = 64,
    private readonly kHashes = 4,
    private readonly sketchBuckets = 16,
  ) {
    this.id = id;
  }

  add(key: string): void {
    this.set.add(key);
  }

  remove(key: string): boolean {
    return this.set.remove(key);
  }

  has(key: string): boolean {
    return this.set.has(key);
  }

  values(): string[] {
    return this.set.values();
  }

  size(): number {
    return this.set.size();
  }

  summary(): Summary {
    const keys = this.set.values();
    const bloom = new BloomFilter(this.mBits, this.kHashes);
    for (const key of keys) bloom.add(key);
    return {
      bloomBits: bloom.toBits(),
      size: keys.length,
      xorFingerprint: xorFingerprint(keys),
    };
  }

  /** Local keys the peer's Bloom filter proves absent (no false negatives). */
  keysAbsentFrom(peerSummary: Summary): string[] {
    const peerBloom = BloomFilter.fromBits(
      peerSummary.bloomBits,
      this.kHashes,
    );
    return this.set
      .values()
      .filter((key) => !peerBloom.mightContain(key))
      .sort();
  }

  ingest(keys: string[]): number {
    let added = 0;
    for (const key of keys) {
      if (!this.set.has(key)) {
        this.set.add(key);
        added++;
      }
    }
    return added;
  }

  fingerprintMismatch(peerSummary: Summary): boolean {
    const local = this.summary();
    return (
      local.size !== peerSummary.size ||
      local.xorFingerprint !== peerSummary.xorFingerprint
    );
  }

  /** Local-only keys recovered exactly from an IBLT-lite sketch difference. */
  exactMissingViaSketch(peerSketch: Sketch): string[] {
    const localSketch = Sketch.fromKeys(this.set.values(), this.sketchBuckets);
    return localSketch.diff(peerSketch, this.set.values());
  }

  /** Exchange Bloom-proved-absent keys both ways, then check convergence. */
  static sync(a: Replica, b: Replica): {
    fromAtoB: string[];
    fromBtoA: string[];
    converged: boolean;
  } {
    const summaryA = a.summary();
    const summaryB = b.summary();

    const fromAtoB = a.keysAbsentFrom(summaryB);
    const fromBtoA = b.keysAbsentFrom(summaryA);

    b.ingest(fromAtoB);
    a.ingest(fromBtoA);

    const converged =
      !a.fingerprintMismatch(b.summary()) &&
      !b.fingerprintMismatch(a.summary());

    return { fromAtoB, fromBtoA, converged };
  }
}

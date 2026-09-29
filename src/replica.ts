import { KeySet } from "./keyset.js";
import { BloomFilter } from "./bloom.js";
import { Sketch } from "./sketch.js";
import { xorFingerprint } from "./hash.js";
import type { Summary } from "./types.js";

/** Bloom-based replica with summary exchange and sketch-assisted sync. */
export class Replica {
  readonly id: string;
  private readonly set = new KeySet();
  private readonly mBits: number;
  private readonly kHashes: number;
  private readonly sketchBuckets: number;

  constructor(
    id: string,
    mBits = 64,
    kHashes = 4,
    sketchBuckets = 16,
  ) {
    this.id = id;
    this.mBits = mBits;
    this.kHashes = kHashes;
    this.sketchBuckets = sketchBuckets;
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

  private bloom(): BloomFilter {
    const bf = new BloomFilter(this.mBits, this.kHashes);
    for (const key of this.set.values()) {
      bf.add(key);
    }
    return bf;
  }

  summary(): Summary {
    return {
      bloomBits: this.bloom().toBits(),
      size: this.set.size(),
      xorFingerprint: xorFingerprint(this.set.values()),
    };
  }

  keysAbsentFrom(peerSummary: Summary): string[] {
    const peerBloom = BloomFilter.fromBits(
      peerSummary.bloomBits,
      this.kHashes,
    );
    return this.set.values().filter((key) => !peerBloom.mightContain(key));
  }

  ingest(keys: string[]): number {
    let added = 0;
    for (const key of keys) {
      if (!this.set.has(key)) {
        this.set.add(key);
        added += 1;
      }
    }
    return added;
  }

  fingerprintMismatch(peerSummary: Summary): boolean {
    const local = this.summary();
    return (
      local.xorFingerprint !== peerSummary.xorFingerprint ||
      local.size !== peerSummary.size
    );
  }

  exactMissingViaSketch(peerSketch: Sketch): string[] {
    const local = Sketch.fromKeys(this.set.values(), this.sketchBuckets);
    return local.diff(peerSketch, this.set.values());
  }

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
    const converged = !a.fingerprintMismatch(b.summary());
    return { fromAtoB, fromBtoA, converged };
  }
}

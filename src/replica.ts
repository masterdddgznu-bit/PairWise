import { KeySet } from "./keyset.js";
import type { Summary } from "./types.js";
import type { Sketch } from "./sketch.js";

/** Bloom-based replica — KeySet ops work; sync stubs throw. */
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

  summary(): Summary {
    throw new Error("summary not implemented");
  }

  keysAbsentFrom(_peerSummary: Summary): string[] {
    throw new Error("keysAbsentFrom not implemented");
  }

  ingest(_keys: string[]): number {
    throw new Error("ingest not implemented");
  }

  fingerprintMismatch(_peerSummary: Summary): boolean {
    throw new Error("fingerprintMismatch not implemented");
  }

  exactMissingViaSketch(_peerSketch: Sketch): string[] {
    throw new Error("exactMissingViaSketch not implemented");
  }

  static sync(_a: Replica, _b: Replica): {
    fromAtoB: string[];
    fromBtoA: string[];
    converged: boolean;
  } {
    throw new Error("sync not implemented");
  }
}

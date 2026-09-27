import { VirtualClock } from "./clock.js";
import { EntryStore } from "./store.js";
import type { DeleteOpts, DiffOp, MerkleProof } from "./types.js";

/**
 * Merkle-backed key-value store.
 * Base put/get/delete/has/keys/size work.
 */
export class MerkleKV {
  readonly clock: VirtualClock;
  /** @internal */ readonly store: EntryStore;

  constructor(clock?: VirtualClock) {
    this.clock = clock ?? new VirtualClock();
    this.store = new EntryStore();
  }

  put(key: string, value: string): void {
    this.store.put(key, value);
  }

  get(key: string): string | undefined {
    return this.store.get(key);
  }

  delete(key: string, opts?: DeleteOpts): boolean {
    if (opts?.ttlMs !== undefined) {
      throw new Error("tombstone ttl not implemented");
    }
    return this.store.delete(key, opts);
  }

  has(key: string): boolean {
    return this.store.has(key);
  }

  keys(): string[] {
    return this.store.keys();
  }

  size(): number {
    return this.store.size();
  }

  rootHash(): string {
    throw new Error("rootHash not implemented");
  }

  getProof(_key: string): MerkleProof | null {
    throw new Error("getProof not implemented");
  }

  verifyProof(_proof: MerkleProof): boolean {
    throw new Error("verifyProof not implemented");
  }

  diffAgainst(_other: MerkleKV): DiffOp[] {
    throw new Error("diffAgainst not implemented");
  }

  applyDiff(_ops: DiffOp[]): void {
    throw new Error("applyDiff not implemented");
  }

  tick(): void {
    throw new Error("tick not implemented");
  }
}

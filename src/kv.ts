import { VirtualClock } from "./clock.js";
import { makeProof, verifyProof as verify } from "./proof.js";
import { EntryStore } from "./store.js";
import { diffEntries } from "./sync.js";
import { computeRoot } from "./tree.js";
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
    return this.store.delete(key, opts, this.clock.now());
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
    return computeRoot(this.store.liveEntries());
  }

  getProof(key: string): MerkleProof | null {
    return makeProof(key, this.store.liveEntries());
  }

  verifyProof(proof: MerkleProof): boolean {
    return verify(proof);
  }

  diffAgainst(other: MerkleKV): DiffOp[] {
    return diffEntries(this.store.allEntries(), other.store.allEntries());
  }

  applyDiff(ops: DiffOp[]): void {
    for (const op of ops) {
      this.store.applyEntry({
        key: op.key,
        value: op.value,
        ver: op.ver,
        deleted: op.deleted,
        expireAt: null,
      });
    }
  }

  tick(): void {
    this.store.tick(this.clock.now());
  }
}

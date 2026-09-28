import type { Delta, TagView, VersionVector } from "./types.js";
import { TagStore } from "./tags.js";
import { AckTable } from "./gc.js";
import { applyDeltaToStore, extractDelta } from "./delta.js";
import { vvGet } from "./vv.js";

/**
 * Observed-Remove Set CRDT.
 * No-arg construction gives a plain local Set; passing a replicaId
 * enables OR-Set semantics with unique dots, tombstones, merge,
 * delta exchange, peer ACKs and stable-point GC.
 */
export class OrSet {
  private readonly plain = new Set<string>();
  private readonly store = new TagStore();
  private readonly acks = new AckTable();
  private localCounter = 0;
  readonly replicaId: string | null;

  constructor(replicaId?: string) {
    this.replicaId = replicaId ?? null;
  }

  add(elem: string): void {
    if (this.replicaId === null) {
      this.plain.add(elem);
      return;
    }
    this.localCounter++;
    this.store.addTag(elem, { replicaId: this.replicaId, counter: this.localCounter });
  }

  remove(elem: string): boolean {
    if (this.replicaId === null) return this.plain.delete(elem);
    return this.store.tombstoneAllLive(elem);
  }

  has(elem: string): boolean {
    if (this.replicaId === null) return this.plain.has(elem);
    return this.store.has(elem);
  }

  values(): string[] {
    if (this.replicaId === null) return [...this.plain].sort();
    return this.store.values();
  }

  size(): number {
    if (this.replicaId === null) return this.plain.size;
    return this.store.size();
  }

  merge(other: OrSet): void {
    if (this.replicaId === null || other.replicaId === null) return;
    this.store.mergeFrom(other.store);
  }

  versionVector(): VersionVector {
    const out: VersionVector = {};
    if (this.replicaId === null) return out;
    for (const { live, tomb } of this.store.allTagged()) {
      for (const dot of [...live, ...tomb]) {
        if (dot.counter > vvGet(out, dot.replicaId)) out[dot.replicaId] = dot.counter;
      }
    }
    return out;
  }

  deltaSince(vv: VersionVector): Delta {
    if (this.replicaId === null) return { adds: [], removes: [] };
    return extractDelta(this.store, vv);
  }

  applyDelta(delta: Delta): void {
    if (this.replicaId === null) return;
    applyDeltaToStore(this.store, delta);
  }

  ack(peer: string, vv: VersionVector): void {
    this.acks.ack(peer, vv);
  }

  minAckVV(): VersionVector {
    return this.acks.minAck();
  }

  gc(): number {
    if (this.replicaId === null) return 0;
    const min = this.acks.minAck();
    return this.store.gcTombstones((dot) => dot.counter <= vvGet(min, dot.replicaId));
  }

  getTags(elem: string): TagView {
    if (this.replicaId === null) return { live: [], tomb: [] };
    return this.store.getTags(elem);
  }

  peersAcked(): string[] {
    return this.acks.peers();
  }
}

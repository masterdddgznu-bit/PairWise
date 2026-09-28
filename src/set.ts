import type { Delta, TagView, VersionVector } from "./types.js";
import { TagStore } from "./tags.js";
import { applyDeltaToStore, extractDelta } from "./delta.js";
import { AckTable } from "./gc.js";
import { vvGet } from "./vv.js";
import { OrSetError } from "./errors.js";

/**
 * Observed-Remove Set CRDT.
 *
 * Without a replicaId it behaves as a plain local Set (base mode).
 * With a replicaId every add is tagged with a unique Dot
 * ({ replicaId, counter }); removes tombstone the currently observed
 * live tags, enabling add-wins concurrent semantics.
 */
export class OrSet {
  private readonly plain = new Set<string>();
  readonly replicaId: string | null;

  private store: TagStore | null = null;
  private ackTable: AckTable | null = null;
  private localCounter = 0;

  constructor(replicaId?: string) {
    this.replicaId = replicaId ?? null;
    if (this.replicaId !== null) {
      this.store = new TagStore();
      this.ackTable = new AckTable();
    }
  }

  add(elem: string): void {
    if (this.replicaId === null) {
      this.plain.add(elem);
      return;
    }
    this.localCounter++;
    this.tagStore().addTag(elem, { replicaId: this.replicaId, counter: this.localCounter });
  }

  remove(elem: string): boolean {
    if (this.replicaId === null) return this.plain.delete(elem);
    return this.tagStore().tombstoneAllLive(elem);
  }

  has(elem: string): boolean {
    if (this.replicaId === null) return this.plain.has(elem);
    return this.tagStore().has(elem);
  }

  values(): string[] {
    if (this.replicaId === null) return [...this.plain].sort();
    return this.tagStore().values();
  }

  size(): number {
    if (this.replicaId === null) return this.plain.size;
    return this.tagStore().size();
  }

  merge(other: OrSet): void {
    if (this.replicaId === null || other.replicaId === null) {
      throw new OrSetError("merge requires replica-backed OrSets");
    }
    this.tagStore().mergeFrom(other.tagStore());
  }

  versionVector(): VersionVector {
    if (this.replicaId === null) throw new OrSetError("versionVector requires a replicaId");
    return this.tagStore().versionVector();
  }

  deltaSince(vv: VersionVector): Delta {
    if (this.replicaId === null) throw new OrSetError("deltaSince requires a replicaId");
    return extractDelta(this.tagStore(), vv ?? {});
  }

  applyDelta(delta: Delta): void {
    if (this.replicaId === null) throw new OrSetError("applyDelta requires a replicaId");
    applyDeltaToStore(this.tagStore(), delta ?? { adds: [], removes: [] });
  }

  ack(peer: string, vv: VersionVector): void {
    if (this.replicaId === null) throw new OrSetError("ack requires a replicaId");
    this.acks().ack(peer, vv ?? {});
  }

  minAckVV(): VersionVector {
    if (this.replicaId === null) throw new OrSetError("minAckVV requires a replicaId");
    return this.acks().minAck();
  }

  gc(): number {
    if (this.replicaId === null) throw new OrSetError("gc requires a replicaId");
    const minAck = this.acks().minAck();
    return this.tagStore().gcTombstones((dot) => dot.counter <= vvGet(minAck, dot.replicaId));
  }

  getTags(elem: string): TagView {
    if (this.replicaId === null) throw new OrSetError("getTags requires a replicaId");
    return this.tagStore().getTags(elem);
  }

  peersAcked(): string[] {
    if (this.replicaId === null) throw new OrSetError("peersAcked requires a replicaId");
    return this.acks().peers();
  }

  private tagStore(): TagStore {
    if (!this.store) throw new OrSetError("OrSet is not replica-backed");
    return this.store;
  }

  private acks(): AckTable {
    if (!this.ackTable) throw new OrSetError("OrSet is not replica-backed");
    return this.ackTable;
  }
}

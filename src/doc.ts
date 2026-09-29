import type { Atom, Delta, Dot, VersionVector } from "./types.js";
import { AtomStore } from "./atoms.js";
import { extractDelta, applyDeltaToStore } from "./delta.js";
import { AckTable } from "./gc.js";
import { visibleDotOrder, visibleString } from "./order.js";
import { vvBump, vvGet } from "./vv.js";
import { RgaError } from "./errors.js";

/**
 * Replicated Growable Array sequence CRDT.
 * Base no-arg string builder insert/delete/toString works.
 * With a replicaId, provides full RGA semantics with tombstones.
 */
export class RgaDoc {
  private readonly chars: string[] = [];
  private readonly store = new AtomStore();
  private readonly acks = new AckTable();
  private localCounter = 0;
  readonly replicaId: string | null;

  constructor(replicaId?: string) {
    this.replicaId = replicaId ?? null;
  }

  private requireReplica(): string {
    if (this.replicaId === null) {
      throw new RgaError("replicaId required for this operation");
    }
    return this.replicaId;
  }

  insert(index: number, ch: string): void {
    if (this.replicaId === null) {
      const i = Math.max(0, Math.min(index, this.chars.length));
      this.chars.splice(i, 0, ch);
      return;
    }
    const ids = this.visibleIds();
    const after = index > 0 ? (ids[index - 1] ?? null) : null;
    this.insertAfter(after, ch);
  }

  delete(index: number): boolean {
    if (this.replicaId === null) {
      if (index < 0 || index >= this.chars.length) return false;
      this.chars.splice(index, 1);
      return true;
    }
    const ids = this.visibleIds();
    if (index < 0 || index >= ids.length) return false;
    return this.deleteById(ids[index]);
  }

  toString(): string {
    if (this.replicaId === null) return this.chars.join("");
    return visibleString(this.store.all());
  }

  length(): number {
    if (this.replicaId === null) return this.chars.length;
    return this.visibleIds().length;
  }

  insertAfter(after: Dot | null, ch: string): Dot {
    const replicaId = this.requireReplica();
    this.localCounter += 1;
    const id: Dot = { replicaId, counter: this.localCounter };
    this.store.insertAfter(after, ch, id);
    return { ...id };
  }

  deleteById(id: Dot): boolean {
    this.requireReplica();
    return this.store.tombstone(id);
  }

  merge(other: RgaDoc): void {
    this.requireReplica();
    this.store.mergeFrom(other.store);
  }

  versionVector(): VersionVector {
    let vv: VersionVector = {};
    for (const atom of this.store.all()) {
      vv = vvBump(vv, atom.id.replicaId, atom.id.counter);
    }
    return vv;
  }

  deltaSince(vv: VersionVector): Delta {
    this.requireReplica();
    return extractDelta(this.store, vv);
  }

  applyDelta(delta: Delta): void {
    this.requireReplica();
    applyDeltaToStore(this.store, delta);
  }

  ack(peer: string, vv: VersionVector): void {
    this.acks.ack(peer, vv);
  }

  minAckVV(): VersionVector {
    return this.acks.minAck();
  }

  gc(): number {
    const min = this.acks.minAck();
    return this.store.gcTombstones(
      (id) => id.counter <= vvGet(min, id.replicaId),
    );
  }

  getAtom(id: Dot): Atom | undefined {
    return this.store.get(id);
  }

  visibleIds(): Dot[] {
    return visibleDotOrder(this.store.all());
  }
}

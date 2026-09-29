import type { Atom, Delta, Dot, VersionVector } from "./types.js";
import { AtomStore } from "./atoms.js";
import { AckTable } from "./gc.js";
import { extractDelta, applyDeltaToStore } from "./delta.js";
import { visibleDotOrder, visibleString } from "./order.js";
import { vvFromAtoms, vvGet } from "./vv.js";
import { RgaError } from "./errors.js";

/**
 * Replicated Growable Array sequence CRDT.
 * Base no-arg string builder insert/delete/toString works.
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
      throw new RgaError("replica operation requires a replicaId");
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
    const i = Math.max(0, Math.min(index, ids.length));
    const after = i === 0 ? null : ids[i - 1]!;
    this.insertAfter(after, ch);
  }

  delete(index: number): boolean {
    if (this.replicaId === null) {
      if (index < 0 || index >= this.chars.length) return false;
      this.chars.splice(index, 1);
      return true;
    }
    const id = this.visibleIds()[index];
    if (id === undefined) return false;
    return this.deleteById(id);
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
    return id;
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
    return vvFromAtoms(this.store.all());
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
    const min = this.minAckVV();
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

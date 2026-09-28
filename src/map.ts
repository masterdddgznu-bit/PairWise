import { DeltaMapError } from "./errors.js";
import type { Delta, Dot, Entry, VersionVector } from "./types.js";
import { EntryStore } from "./entries.js";
import { applyDelta as applyDeltaEntries, extractDelta } from "./delta.js";
import { AckTable, sweepTombstones } from "./gc.js";
import { vvGet } from "./vv.js";

/**
 * Delta-state LWW-Map.
 * No-arg construction is a plain local Map (base tests); a `replicaId`
 * enables dots, tombstones, merge, deltas, ACK and GC.
 */
export class DeltaMap {
  private readonly map = new Map<string, string>();
  private readonly store = new EntryStore();
  private readonly acks = new AckTable();
  private localCounter = 0;
  readonly replicaId: string | null;

  constructor(replicaId?: string) {
    this.replicaId = replicaId ?? null;
  }

  private feature(): EntryStore {
    if (this.replicaId === null) {
      throw new DeltaMapError("operation requires a replicaId");
    }
    return this.store;
  }

  private nextDot(): Dot {
    return { replicaId: this.replicaId as string, counter: ++this.localCounter };
  }

  put(key: string, value: string): void {
    if (this.replicaId === null) {
      this.map.set(key, value);
      return;
    }
    this.store.put(key, value, this.nextDot());
  }

  get(key: string): string | undefined {
    if (this.replicaId === null) return this.map.get(key);
    return this.store.getValue(key);
  }

  delete(key: string): boolean {
    if (this.replicaId === null) return this.map.delete(key);
    return this.store.tombstone(key, this.nextDot());
  }

  has(key: string): boolean {
    if (this.replicaId === null) return this.map.has(key);
    return this.store.has(key);
  }

  keys(): string[] {
    if (this.replicaId === null) return [...this.map.keys()].sort();
    return this.store.keys();
  }

  size(): number {
    if (this.replicaId === null) return this.map.size;
    return this.store.size();
  }

  /** LWW-merge every entry (including tombstones) from another replica. */
  merge(other: DeltaMap): void {
    this.feature();
    for (const e of other.store.all()) this.store.applyLww(e);
  }

  versionVector(): VersionVector {
    this.feature();
    const vv: VersionVector = {};
    for (const e of this.store.all()) {
      if (e.dot.counter > vvGet(vv, e.dot.replicaId)) {
        vv[e.dot.replicaId] = e.dot.counter;
      }
    }
    return vv;
  }

  deltaSince(vv: VersionVector): Delta {
    return extractDelta(this.feature().all(), vv);
  }

  applyDelta(delta: Delta): void {
    applyDeltaEntries(this.feature(), delta);
  }

  ack(peer: string, vv: VersionVector): void {
    this.feature();
    this.acks.ack(peer, vv);
  }

  minAckVV(): VersionVector {
    this.feature();
    return this.acks.minAck();
  }

  gc(): number {
    return sweepTombstones(this.feature(), this.acks.minAck());
  }

  getEntry(key: string): Entry | undefined {
    return this.feature().getEntry(key);
  }

  peersAcked(): string[] {
    this.feature();
    return this.acks.peers();
  }
}

import type { Delta, Entry, VersionVector } from "./types.js";
import { AckTable } from "./gc.js";
import { EntryStore } from "./entries.js";
import { extractDelta } from "./delta.js";
import { vvBump, vvGet } from "./vv.js";

/**
 * Delta-state LWW-Map.
 * No-arg construction stays a plain Map for base tests;
 * passing a replicaId enables dots, merge, deltas and GC.
 */
export class DeltaMap {
  private readonly map = new Map<string, string>();
  readonly replicaId: string | null;
  private readonly store?: EntryStore;
  private readonly acks?: AckTable;
  private localCounter = 0;
  private knowledge: VersionVector = {};

  constructor(replicaId?: string) {
    this.replicaId = replicaId ?? null;
    if (this.replicaId !== null) {
      this.store = new EntryStore();
      this.acks = new AckTable();
    }
  }

  put(key: string, value: string): void {
    if (this.replicaId === null || this.store === undefined) {
      this.map.set(key, value);
      return;
    }
    const counter = ++this.localCounter;
    const dot = { replicaId: this.replicaId, counter };
    this.store.put(key, value, dot);
    this.knowledge = vvBump(this.knowledge, this.replicaId, counter);
  }

  get(key: string): string | undefined {
    if (this.replicaId === null || this.store === undefined) {
      return this.map.get(key);
    }
    return this.store.getValue(key);
  }

  delete(key: string): boolean {
    if (this.replicaId === null || this.store === undefined) {
      return this.map.delete(key);
    }
    const existing = this.store.getEntry(key);
    if (existing === undefined || existing.value === null) return false;
    const counter = ++this.localCounter;
    const ok = this.store.tombstone(key, { replicaId: this.replicaId, counter });
    if (ok) {
      this.knowledge = vvBump(this.knowledge, this.replicaId, counter);
    }
    return ok;
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  keys(): string[] {
    if (this.replicaId === null || this.store === undefined) {
      return [...this.map.keys()].sort();
    }
    return this.store.keys();
  }

  size(): number {
    if (this.replicaId === null || this.store === undefined) {
      return this.map.size;
    }
    return this.store.size();
  }

  merge(other: DeltaMap): void {
    if (this.store === undefined || other.store === undefined) {
      throw new Error("merge requires replica-enabled DeltaMaps");
    }
    for (const entry of other.store.all()) {
      this.store.applyLww(entry);
      this.knowledge = vvBump(this.knowledge, entry.dot.replicaId, entry.dot.counter);
    }
  }

  versionVector(): VersionVector {
    return { ...this.knowledge };
  }

  deltaSince(vv: VersionVector): Delta {
    if (this.store === undefined) {
      throw new Error("deltaSince requires a replica-enabled DeltaMap");
    }
    return extractDelta(this.store.all(), vv);
  }

  applyDelta(delta: Delta): void {
    if (this.store === undefined) {
      throw new Error("applyDelta requires a replica-enabled DeltaMap");
    }
    for (const entry of delta.entries) {
      this.store.applyLww(entry);
      this.knowledge = vvBump(this.knowledge, entry.dot.replicaId, entry.dot.counter);
    }
  }

  ack(peer: string, vv: VersionVector): void {
    if (this.acks === undefined) {
      throw new Error("ack requires a replica-enabled DeltaMap");
    }
    this.acks.ack(peer, vv);
  }

  minAckVV(): VersionVector {
    if (this.acks === undefined) {
      throw new Error("minAckVV requires a replica-enabled DeltaMap");
    }
    return this.acks.minAck();
  }

  gc(): number {
    if (this.store === undefined || this.acks === undefined) {
      throw new Error("gc requires a replica-enabled DeltaMap");
    }
    const minAck = this.acks.minAck();
    return this.store.removeTombstones(
      (entry) => entry.dot.counter <= vvGet(minAck, entry.dot.replicaId),
    );
  }

  getEntry(key: string): Entry | undefined {
    return this.store?.getEntry(key);
  }

  peersAcked(): string[] {
    return this.acks?.peers() ?? [];
  }
}

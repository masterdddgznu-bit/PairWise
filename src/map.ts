import type { Delta, Entry, VersionVector } from "./types.js";

/**
 * Delta-state LWW-Map.
 * Base no-arg Map put/get/delete works.
 */
export class DeltaMap {
  private readonly map = new Map<string, string>();
  readonly replicaId: string | null;

  constructor(replicaId?: string) {
    this.replicaId = replicaId ?? null;
  }

  put(key: string, value: string): void {
    if (this.replicaId === null) {
      this.map.set(key, value);
      return;
    }
    throw new Error("replica put not implemented");
  }

  get(key: string): string | undefined {
    if (this.replicaId === null) return this.map.get(key);
    throw new Error("replica get not implemented");
  }

  delete(key: string): boolean {
    if (this.replicaId === null) return this.map.delete(key);
    throw new Error("replica delete not implemented");
  }

  has(key: string): boolean {
    if (this.replicaId === null) return this.map.has(key);
    throw new Error("replica has not implemented");
  }

  keys(): string[] {
    if (this.replicaId === null) return [...this.map.keys()].sort();
    throw new Error("replica keys not implemented");
  }

  size(): number {
    if (this.replicaId === null) return this.map.size;
    throw new Error("replica size not implemented");
  }

  merge(_other: DeltaMap): void {
    throw new Error("merge not implemented");
  }

  versionVector(): VersionVector {
    throw new Error("versionVector not implemented");
  }

  deltaSince(_vv: VersionVector): Delta {
    throw new Error("deltaSince not implemented");
  }

  applyDelta(_delta: Delta): void {
    throw new Error("applyDelta not implemented");
  }

  ack(_peer: string, _vv: VersionVector): void {
    throw new Error("ack not implemented");
  }

  minAckVV(): VersionVector {
    throw new Error("minAckVV not implemented");
  }

  gc(): number {
    throw new Error("gc not implemented");
  }

  getEntry(_key: string): Entry | undefined {
    throw new Error("getEntry not implemented");
  }

  peersAcked(): string[] {
    throw new Error("peersAcked not implemented");
  }
}

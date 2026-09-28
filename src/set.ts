import type { Delta, TagView, VersionVector } from "./types.js";

/**
 * Observed-Remove Set CRDT.
 * Base no-arg Set add/remove/has works.
 */
export class OrSet {
  private readonly plain = new Set<string>();
  readonly replicaId: string | null;

  constructor(replicaId?: string) {
    this.replicaId = replicaId ?? null;
  }

  add(elem: string): void {
    if (this.replicaId === null) {
      this.plain.add(elem);
      return;
    }
    throw new Error("replica add not implemented");
  }

  remove(elem: string): boolean {
    if (this.replicaId === null) return this.plain.delete(elem);
    throw new Error("replica remove not implemented");
  }

  has(elem: string): boolean {
    if (this.replicaId === null) return this.plain.has(elem);
    throw new Error("replica has not implemented");
  }

  values(): string[] {
    if (this.replicaId === null) return [...this.plain].sort();
    throw new Error("replica values not implemented");
  }

  size(): number {
    if (this.replicaId === null) return this.plain.size;
    throw new Error("replica size not implemented");
  }

  merge(_other: OrSet): void {
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

  getTags(_elem: string): TagView {
    throw new Error("getTags not implemented");
  }

  peersAcked(): string[] {
    throw new Error("peersAcked not implemented");
  }
}

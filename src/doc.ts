import type { Atom, Delta, Dot, VersionVector } from "./types.js";

/**
 * Replicated Growable Array sequence CRDT.
 * Base no-arg string builder insert/delete/toString works.
 */
export class RgaDoc {
  private readonly chars: string[] = [];
  readonly replicaId: string | null;

  constructor(replicaId?: string) {
    this.replicaId = replicaId ?? null;
  }

  insert(index: number, ch: string): void {
    if (this.replicaId === null) {
      const i = Math.max(0, Math.min(index, this.chars.length));
      this.chars.splice(i, 0, ch);
      return;
    }
    throw new Error("replica insert not implemented");
  }

  delete(index: number): boolean {
    if (this.replicaId === null) {
      if (index < 0 || index >= this.chars.length) return false;
      this.chars.splice(index, 1);
      return true;
    }
    throw new Error("replica delete not implemented");
  }

  toString(): string {
    if (this.replicaId === null) return this.chars.join("");
    throw new Error("replica toString not implemented");
  }

  length(): number {
    if (this.replicaId === null) return this.chars.length;
    throw new Error("replica length not implemented");
  }

  insertAfter(_after: Dot | null, _ch: string): Dot {
    throw new Error("insertAfter not implemented");
  }

  deleteById(_id: Dot): boolean {
    throw new Error("deleteById not implemented");
  }

  merge(_other: RgaDoc): void {
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

  getAtom(_id: Dot): Atom | undefined {
    throw new Error("getAtom not implemented");
  }

  visibleIds(): Dot[] {
    throw new Error("visibleIds not implemented");
  }
}

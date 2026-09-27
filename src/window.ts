import type { Packet } from "./types.js";

/** Sliding window slots over [base, base + size). */
export class WindowSlots {
  private readonly slots = new Map<number, Packet>();

  constructor(
    private readonly size: number,
    private base = 0,
  ) {}

  setBase(base: number): void {
    this.base = base;
    for (const seq of this.slots.keys()) {
      if (seq < base) this.slots.delete(seq);
    }
  }

  getBase(): number {
    return this.base;
  }

  inWindow(seq: number): boolean {
    return seq >= this.base && seq < this.base + this.size;
  }

  has(seq: number): boolean {
    return this.slots.has(seq);
  }

  put(pkt: Packet): void {
    this.slots.set(pkt.seq, pkt);
  }

  take(seq: number): Packet | null {
    const pkt = this.slots.get(seq);
    if (pkt === undefined) return null;
    this.slots.delete(seq);
    return pkt;
  }

  count(): number {
    return this.slots.size;
  }

  maxBufferedSeq(): number | null {
    let max: number | null = null;
    for (const seq of this.slots.keys()) {
      if (max === null || seq > max) max = seq;
    }
    return max;
  }
}

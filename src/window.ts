import type { Packet } from "./types.js";

/** Sliding window slots — stub. */
export class WindowSlots {
  constructor(
    private readonly size: number,
    private base = 0,
  ) {
    void this.size;
    void this.base;
  }

  setBase(_base: number): void {
    /* stub */
  }

  getBase(): number {
    return this.base;
  }

  inWindow(_seq: number): boolean {
    return false;
  }

  has(_seq: number): boolean {
    return false;
  }

  put(_pkt: Packet): void {
    /* stub */
  }

  take(_seq: number): Packet | null {
    return null;
  }

  count(): number {
    return 0;
  }

  maxBufferedSeq(): number | null {
    return null;
  }
}

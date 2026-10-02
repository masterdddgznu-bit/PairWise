import { ClockError } from "./errors.js";
import type { ClockState, ClockStats, Frame } from "./types.js";

/** CLOCK / second-chance cache — starter stub. */
export class ClockCache {
  constructor(_capacity: number) {
    /* params accepted; methods throw until implemented */
  }

  put(_key: string, _value: number): void {
    throw new Error("put not implemented");
  }

  get(_key: string): number | undefined {
    throw new Error("get not implemented");
  }

  has(_key: string): boolean {
    throw new Error("has not implemented");
  }

  size(): number {
    throw new Error("size not implemented");
  }

  peek(_key: string): number | undefined {
    throw new Error("peek not implemented");
  }

  frames(): Frame[] {
    throw new Error("frames not implemented");
  }

  handPosition(): number {
    throw new Error("handPosition not implemented");
  }

  exportState(): ClockState {
    throw new Error("exportState not implemented");
  }

  static fromState(_state: ClockState): ClockCache {
    throw new Error("fromState not implemented");
  }

  freeze(): void {
    throw new Error("freeze not implemented");
  }

  stats(): ClockStats {
    throw new Error("stats not implemented");
  }
}

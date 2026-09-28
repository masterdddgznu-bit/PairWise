import type { RepairRequest } from "./types.js";
import type { VirtualClock } from "./clock.js";

export class RepairTimer {
  constructor(
    _n: number,
    _clock: VirtualClock,
    _timeoutMs: number,
  ) {}

  noteBufferNonEmpty(_to: number): void {
    throw new Error("repair timer not implemented");
  }

  noteBufferEmpty(_to: number): void {
    throw new Error("repair timer not implemented");
  }

  tick(_missingOf: (to: number) => { from: number; seq: number }[]): RepairRequest[] {
    throw new Error("repair tick not implemented");
  }

  drain(): RepairRequest[] {
    return [];
  }
}

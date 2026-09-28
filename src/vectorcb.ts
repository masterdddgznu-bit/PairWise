import { VirtualClock } from "./clock.js";
import type { Delivered, Vector } from "./types.js";

export type VectorCbOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class VectorCb {
  readonly clock: VirtualClock;
  constructor(opts: VectorCbOptions) {
    this.clock = opts.clock;
  }
  broadcast(_from: number, _payload: string): string { return ""; }
  step(_to: number): boolean { return false; }
  pump(_to?: number): void { /* stub */ }
  delivered(_id: number): Delivered[] { return []; }
  clockOf(_id: number): Vector { return []; }
  buffered(_id: number): string[] { return []; }
  inboxSize(_id: number): number { return 0; }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  isOnline(_id: number): boolean { return true; }
}

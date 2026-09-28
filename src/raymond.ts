import { VirtualClock } from "./clock.js";
import type { ProcState } from "./types.js";

export type RaymondOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

export class Raymond {
  readonly clock: VirtualClock;
  constructor(opts: RaymondOptions) {
    this.clock = opts.clock;
  }
  request(_id: number): string { return ""; }
  release(_id: number): string { return ""; }
  step(_id: number): boolean { return false; }
  pump(_to?: number): void { /* stub */ }
  stateOf(_id: number): ProcState { return "idle"; }
  parentOf(_id: number): number { return 0; }
  hasToken(_id: number): boolean { return false; }
  holder(): number | null { return null; }
  queueOf(_id: number): number[] { return []; }
  neighborsOf(_id: number): number[] { return []; }
  inboxSize(_id: number): number { return 0; }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  isOnline(_id: number): boolean { return true; }
}

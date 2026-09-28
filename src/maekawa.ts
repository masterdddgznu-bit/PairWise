import { VirtualClock } from "./clock.js";
import type { ProcState } from "./types.js";

export type MaekawaOptions = {
  clock: VirtualClock;
  processCount?: number;
  votingSets?: number[][];
};

export class Maekawa {
  readonly clock: VirtualClock;
  constructor(opts: MaekawaOptions) {
    this.clock = opts.clock;
  }
  request(_id: number): string { return ""; }
  release(_id: number): string { return ""; }
  step(_id: number): boolean { return false; }
  pump(_to?: number): void { /* stub */ }
  stateOf(_id: number): ProcState { return "idle"; }
  holder(): number | null { return null; }
  repliesOf(_id: number): number[] { return []; }
  votingFor(_id: number): number | null { return null; }
  queuedAt(_id: number): number[] { return []; }
  inboxSize(_id: number): number { return 0; }
  lamportOf(_id: number): number { return 0; }
  votingSet(_id: number): number[] { return []; }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  isOnline(_id: number): boolean { return true; }
}

import { VirtualClock } from "./clock.js";
import type { ProcState } from "./types.js";

export type SuzukOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class Suzuk {
  readonly clock: VirtualClock;
  constructor(opts: SuzukOptions) {
    this.clock = opts.clock;
  }
  request(_id: number): string { return ""; }
  release(_id: number): string { return ""; }
  step(_id: number): boolean { return false; }
  pump(_to?: number): void { /* stub */ }
  stateOf(_id: number): ProcState { return "idle"; }
  holder(): number | null { return null; }
  hasToken(_id: number): boolean { return false; }
  rnOf(_id: number): number[] { return []; }
  tokenLn(): number[] | null { return null; }
  tokenQueue(): number[] | null { return null; }
  inboxSize(_id: number): number { return 0; }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  isOnline(_id: number): boolean { return true; }
}

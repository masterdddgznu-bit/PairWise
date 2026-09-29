import { VirtualClock } from "./clock.js";
import type { ProcState } from "./types.js";

export type NaimiOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class Naimi {
  readonly clock: VirtualClock;
  constructor(opts: NaimiOptions) {
    this.clock = opts.clock;
  }
  request(_id: number): string { return ""; }
  release(_id: number): string { return ""; }
  step(_id: number): boolean { return false; }
  pump(_to?: number): void { /* stub */ }
  stateOf(_id: number): ProcState { return "idle"; }
  hasToken(_id: number): boolean { return false; }
  lastOf(_id: number): number { return 0; }
  nextOf(_id: number): number | null { return null; }
  holder(): number | null { return null; }
  isRequesting(_id: number): boolean { return false; }
  inboxSize(_id: number): number { return 0; }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  isOnline(_id: number): boolean { return true; }
}

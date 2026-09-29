import { VirtualClock } from "./clock.js";

export type HirschOptions = {
  clock: VirtualClock;
  processCount?: number;
  uids?: number[];
};

export class Hirsch {
  readonly clock: VirtualClock;
  constructor(opts: HirschOptions) {
    this.clock = opts.clock;
  }
  start(_id: number): string { return ""; }
  step(_id: number): boolean { return false; }
  pump(_to?: number): void { /* stub */ }
  uidOf(_id: number): number { return 0; }
  leaderOf(_id: number): number | null { return null; }
  leader(): number | null { return null; }
  isParticipant(_id: number): boolean { return false; }
  phaseOf(_id: number): number { return 0; }
  repliesOf(_id: number): number { return 0; }
  inboxSize(_id: number): number { return 0; }
  leftOf(_id: number): number { return 0; }
  rightOf(_id: number): number { return 0; }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  isOnline(_id: number): boolean { return true; }
}

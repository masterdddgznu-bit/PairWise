import { VirtualClock } from "./clock.js";

export type ChangRobOptions = {
  clock: VirtualClock;
  processCount?: number;
  uids?: number[];
};

export class ChangRob {
  readonly clock: VirtualClock;
  constructor(opts: ChangRobOptions) {
    this.clock = opts.clock;
  }
  start(_id: number): string { return ""; }
  step(_id: number): boolean { return false; }
  pump(_to?: number): void { /* stub */ }
  uidOf(_id: number): number { return 0; }
  leaderOf(_id: number): number | null { return null; }
  leader(): number | null { return null; }
  isParticipant(_id: number): boolean { return false; }
  inboxSize(_id: number): number { return 0; }
  nextOf(_id: number): number { return 0; }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  isOnline(_id: number): boolean { return true; }
}

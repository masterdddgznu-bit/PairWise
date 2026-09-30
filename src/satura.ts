import { VirtualClock } from "./clock.js";

export type SaturaOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
  uids?: number[];
};

export class Satura {
  readonly clock: VirtualClock;
  constructor(opts: SaturaOptions) {
    this.clock = opts.clock;
  }
  start(): number { return 0; }
  step(_id: number): boolean { return false; }
  pump(_to?: number): void { /* stub */ }
  converged(): boolean { return false; }
  knownOf(_id: number): number | null { return null; }
  uidOf(_id: number): number { return 0; }
  leaderUid(): number | null { return null; }
  leaderId(): number | null { return null; }
  isLeader(_id: number): boolean { return false; }
  neighborsOf(_id: number): number[] { return []; }
  inboxSize(_id: number): number { return 0; }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  isOnline(_id: number): boolean { return true; }
}

import { VirtualClock } from "./clock.js";

export type BetaSyncOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
  rootId?: number;
};

export class BetaSync {
  readonly clock: VirtualClock;
  constructor(opts: BetaSyncOptions) {
    this.clock = opts.clock;
  }
  reset(): void { /* stub */ }
  begin(): number { return 0; }
  step(_id: number): boolean { return false; }
  pump(_to?: number): void { /* stub */ }
  pulseOf(_id: number): number { return 0; }
  minPulse(): number { return 0; }
  maxPulse(): number { return 0; }
  barrier(_targetPulse: number): number { return 0; }
  synced(): boolean { return false; }
  rootId(): number { return 0; }
  parentOf(_id: number): number | null { return null; }
  childrenOf(_id: number): number[] { return []; }
  neighborsOf(_id: number): number[] { return []; }
  inboxSize(_id: number): number { return 0; }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  isOnline(_id: number): boolean { return true; }
}

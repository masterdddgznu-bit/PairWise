import { VirtualClock } from "./clock.js";

export type AlphaSyncOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

export class AlphaSync {
  readonly clock: VirtualClock;
  constructor(opts: AlphaSyncOptions) {
    this.clock = opts.clock;
  }
  reset(): void { /* stub */ }
  emit(_id: number): number { return 0; }
  step(_id: number): boolean { return false; }
  pump(_to?: number): void { /* stub */ }
  pulseOf(_id: number): number { return 0; }
  minPulse(): number { return 0; }
  maxPulse(): number { return 0; }
  barrier(_targetPulse: number): number { return 0; }
  synced(): boolean { return false; }
  neighborsOf(_id: number): number[] { return []; }
  inboxSize(_id: number): number { return 0; }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  isOnline(_id: number): boolean { return true; }
}

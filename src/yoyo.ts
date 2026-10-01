import { VirtualClock } from "./clock.js";

export type YoYoOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
  uids?: number[];
};

export class YoYo {
  readonly clock: VirtualClock;
  constructor(opts: YoYoOptions) {
    this.clock = opts.clock;
  }
  reset(): void { /* stub */ }
  begin(): number { return 0; }
  step(_id: number): boolean { return false; }
  pump(_to?: number): void { /* stub */ }
  uidOf(_id: number): number { return 0; }
  activeNeighbors(_id: number): number[] { return []; }
  outNeighbors(_id: number): number[] { return []; }
  inNeighbors(_id: number): number[] { return []; }
  isSource(_id: number): boolean { return false; }
  isSink(_id: number): boolean { return false; }
  sources(): number[] { return []; }
  leader(): number | null { return null; }
  converged(): boolean { return false; }
  barrier(): number | null { return null; }
  neighborsOf(_id: number): number[] { return []; }
  inboxSize(_id: number): number { return 0; }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  isOnline(_id: number): boolean { return true; }
}

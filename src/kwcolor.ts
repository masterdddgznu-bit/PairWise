import { VirtualClock } from "./clock.js";
import type { Phase } from "./types.js";

export type KWColorOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

export class KWColor {
  readonly clock: VirtualClock;
  constructor(opts: KWColorOptions) {
    this.clock = opts.clock;
  }
  reset(): void { /* stub */ }
  start(): void { /* stub */ }
  step(_id: number): boolean { return false; }
  pump(): void { /* stub */ }
  reduceRound(): boolean { return false; }
  run(): void { /* stub */ }
  colorOf(_id: number): number { return -1; }
  colors(): number[] { return []; }
  neighborsOf(_id: number): number[] { return []; }
  delta(): number { return -1; }
  target(): number { return -1; }
  paletteBound(): number { return -1; }
  roundIndex(): number { return -1; }
  isProper(): boolean { return false; }
  maxColor(): number { return -1; }
  phase(): Phase { return "idle"; }
  inboxSize(_id: number): number { return 0; }
  processCount(): number { return 0; }
}

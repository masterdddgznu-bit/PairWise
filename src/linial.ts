import { VirtualClock } from "./clock.js";
import type { Rng } from "./rng.js";
import type { Phase } from "./types.js";

export type LinialOptions = {
  clock: VirtualClock;
  rng: Rng;
  processCount?: number;
  edges?: number[][];
  maxRounds?: number;
};

export class Linial {
  readonly clock: VirtualClock;
  readonly rng: Rng;
  constructor(opts: LinialOptions) {
    this.clock = opts.clock;
    this.rng = opts.rng;
  }
  reset(): void { /* stub */ }
  start(): void { /* stub */ }
  step(_id: number): boolean { return false; }
  pump(): void { /* stub */ }
  linialRound(): boolean { return false; }
  run(): void { /* stub */ }
  colorOf(_id: number): number { return -1; }
  colors(): number[] { return []; }
  neighborsOf(_id: number): number[] { return []; }
  delta(): number { return -1; }
  roundIndex(): number { return -1; }
  isProper(): boolean { return false; }
  maxColor(): number { return -1; }
  paletteSize(): number { return 0; }
  phase(): Phase { return "idle"; }
  inboxSize(_id: number): number { return 0; }
  processCount(): number { return 0; }
}

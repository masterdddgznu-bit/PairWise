import { VirtualClock } from "./clock.js";
import type { Phase } from "./types.js";

export type CVColorOptions = {
  clock: VirtualClock;
  processCount: number;
};

export class CVColor {
  readonly clock: VirtualClock;
  constructor(opts: CVColorOptions) {
    this.clock = opts.clock;
  }
  reset(): void { /* stub */ }
  start(): void { /* stub */ }
  step(_id: number): boolean { return false; }
  pump(): void { /* stub */ }
  sixRound(): boolean { return false; }
  reduceToSix(): void { /* stub */ }
  threeRound(_victim: number): void { /* stub */ }
  reduceToThree(): void { /* stub */ }
  run(): void { /* stub */ }
  colorOf(_id: number): number { return -1; }
  colors(): number[] { return []; }
  predOf(_id: number): number { return -1; }
  succOf(_id: number): number { return -1; }
  isProper(): boolean { return false; }
  maxColor(): number { return -1; }
  paletteSize(): number { return 0; }
  epoch(): number { return -1; }
  phase(): Phase { return "idle"; }
  inboxSize(_id: number): number { return 0; }
  processCount(): number { return 0; }
}

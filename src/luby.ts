import { VirtualClock } from "./clock.js";
import type { Rng } from "./rng.js";

export type LubyOptions = {
  clock: VirtualClock;
  rng: Rng;
  processCount?: number;
  edges?: number[][];
};

export class Luby {
  readonly clock: VirtualClock;
  readonly rng: Rng;
  constructor(opts: LubyOptions) {
    this.clock = opts.clock;
    this.rng = opts.rng;
  }
  reset(): void { /* stub */ }
  start(): void { /* stub */ }
  step(_id: number): boolean { return false; }
  pump(): void { /* stub */ }
  round(): boolean { return false; }
  run(): void { /* stub */ }
  isActive(_id: number): boolean { return false; }
  inMis(_id: number): boolean { return false; }
  mis(): number[] { return []; }
  neighborsOf(_id: number): number[] { return []; }
  inboxSize(_id: number): number { return 0; }
  isIndependent(): boolean { return false; }
  isMaximal(): boolean { return false; }
  processCount(): number { return 0; }
}

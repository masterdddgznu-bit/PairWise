import { VirtualClock } from "./clock.js";
import type { Rng } from "./rng.js";

export type IIMatchOptions = {
  clock: VirtualClock;
  rng: Rng;
  processCount?: number;
  edges?: number[][];
};

export class IIMatch {
  readonly clock: VirtualClock;
  readonly rng: Rng;
  constructor(opts: IIMatchOptions) {
    this.clock = opts.clock;
    this.rng = opts.rng;
  }
  reset(): void { /* stub */ }
  start(): void { /* stub */ }
  step(_id: number): boolean { return false; }
  pump(): void { /* stub */ }
  round(): boolean { return false; }
  run(): void { /* stub */ }
  isFree(_id: number): boolean { return false; }
  mateOf(_id: number): number | null { return null; }
  matching(): number[][] { return []; }
  neighborsOf(_id: number): number[] { return []; }
  inboxSize(_id: number): number { return 0; }
  isMatching(): boolean { return false; }
  isMaximal(): boolean { return false; }
  processCount(): number { return 0; }
}

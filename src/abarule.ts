import { VirtualClock } from "./clock.js";
import type { Rng } from "./rng.js";
import type { Phase } from "./types.js";

export type AbaRuleOptions = {
  clock: VirtualClock;
  rng: Rng;
  processCount?: number;
  edges?: number[][];
  maxRounds?: number;
};

export class AbaRule {
  readonly clock: VirtualClock;
  readonly rng: Rng;
  constructor(opts: AbaRuleOptions) {
    this.clock = opts.clock;
    this.rng = opts.rng;
  }
  reset(): void { /* stub */ }
  start(): void { /* stub */ }
  step(_id: number): boolean { return false; }
  pump(): void { /* stub */ }
  abiRound(): boolean { return false; }
  run(): void { /* stub */ }
  isActive(_id: number): boolean { return false; }
  inMis(_id: number): boolean { return false; }
  isBlocked(_id: number): boolean { return false; }
  freeDeg(_id: number): number { return -1; }
  mis(): number[] { return []; }
  neighborsOf(_id: number): number[] { return []; }
  isIndependent(): boolean { return false; }
  isMaximal(): boolean { return false; }
  roundIndex(): number { return -1; }
  phase(): Phase { return "idle"; }
  inboxSize(_id: number): number { return 0; }
  processCount(): number { return 0; }
}

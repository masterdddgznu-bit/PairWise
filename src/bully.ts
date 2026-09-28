import { VirtualClock } from "./clock.js";
import type { NodeState } from "./types.js";

export type BullyOptions = {
  clock: VirtualClock;
  nodeCount?: number;
  electionTimeout?: number;
};

export class Bully {
  readonly clock: VirtualClock;
  constructor(opts: BullyOptions) {
    this.clock = opts.clock;
  }
  startElection(_id: number): void { /* stub */ }
  tick(): void { /* stub */ }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  leaderOf(_id: number): number | null { return null; }
  state(_id: number): NodeState { return "idle"; }
  isOnline(_id: number): boolean { return true; }
  coordinator(): number | null { return null; }
}

import { VirtualClock } from "./clock.js";
import type { EdgeState, WeightedEdge } from "./types.js";

export type GHSOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: WeightedEdge[];
};

export class GHS {
  readonly clock: VirtualClock;
  constructor(opts: GHSOptions) { this.clock = opts.clock; }
  reset(): void { /* stub */ }
  begin(): number { return 0; }
  step(_id: number): boolean { return false; }
  pump(_to?: number): void { /* stub */ }
  fragmentOf(_id: number): number { return 0; }
  leaderOf(_id: number): number { return 0; }
  parentOf(_id: number): number | null { return null; }
  childrenOf(_id: number): number[] { return []; }
  edgeState(_u: number, _v: number): EdgeState { return "basic"; }
  mstEdges(): WeightedEdge[] { return []; }
  mstWeight(): number { return 0; }
  done(): boolean { return false; }
  barrier(): number { return 0; }
  neighborsOf(_id: number): Array<{ id: number; w: number }> { return []; }
  inboxSize(_id: number): number { return 0; }
}

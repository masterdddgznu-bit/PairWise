import { VirtualClock } from "./clock.js";

export type GammaSyncOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
  treeEdges?: number[][];
  clusterOf?: number[];
  clusterRoots?: number[];
};

export class GammaSync {
  readonly clock: VirtualClock;
  constructor(opts: GammaSyncOptions) {
    this.clock = opts.clock;
  }
  reset(): void { /* stub */ }
  begin(): number { return 0; }
  step(_id: number): boolean { return false; }
  pump(_to?: number): void { /* stub */ }
  pulseOf(_id: number): number { return 0; }
  minPulse(): number { return 0; }
  maxPulse(): number { return 0; }
  barrier(_targetPulse: number): number { return 0; }
  synced(): boolean { return false; }
  clusterOf(_id: number): number { return 0; }
  clusterRoot(_clusterId: number): number { return 0; }
  parentOf(_id: number): number | null { return null; }
  childrenOf(_id: number): number[] { return []; }
  leaderNeighbors(_rootId: number): number[] { return []; }
  neighborsOf(_id: number): number[] { return []; }
  inboxSize(_id: number): number { return 0; }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  isOnline(_id: number): boolean { return true; }
}

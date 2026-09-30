import { VirtualClock } from "./clock.js";

export type AsyncBfsOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
};

export class AsyncBfs {
  readonly clock: VirtualClock;
  constructor(opts: AsyncBfsOptions) {
    this.clock = opts.clock;
  }
  start(_rootId: number): number { return 0; }
  step(_id: number): boolean { return false; }
  pump(_to?: number): void { /* stub */ }
  converged(): boolean { return false; }
  rootId(): number | null { return null; }
  distOf(_id: number): number | null { return null; }
  parentOf(_id: number): number | null { return null; }
  childrenOf(_id: number): number[] { return []; }
  inTree(_id: number): boolean { return false; }
  treeEdgeCount(): number { return 0; }
  neighborsOf(_id: number): number[] { return []; }
  inboxSize(_id: number): number { return 0; }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  isOnline(_id: number): boolean { return true; }
}

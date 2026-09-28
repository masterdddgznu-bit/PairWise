import { VirtualClock } from "./clock.js";
import type { NodeState, OpStatus } from "./types.js";

export type RicartOptions = {
  clock: VirtualClock;
  nodeCount?: number;
};

export class Ricart {
  readonly clock: VirtualClock;
  constructor(opts: RicartOptions) {
    this.clock = opts.clock;
  }
  request(_id: number): string { return ""; }
  exit(_id: number): void { /* stub */ }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  state(_id: number): NodeState { return "idle"; }
  clockOf(_id: number): number { return 0; }
  isOnline(_id: number): boolean { return true; }
  deferred(_id: number): number[] { return []; }
  status(_opId: string): OpStatus { return "unknown"; }
  holder(): number | null { return null; }
}

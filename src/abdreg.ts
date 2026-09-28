import { VirtualClock } from "./clock.js";
import type { OpStatus, ReplicaStore } from "./types.js";

export type AbdRegOptions = {
  clock: VirtualClock;
  replicaCount?: number;
};

export class AbdReg {
  readonly clock: VirtualClock;
  constructor(opts: AbdRegOptions) {
    this.clock = opts.clock;
  }
  beginWrite(_writerId: number, _value: string): string { return ""; }
  beginRead(): string { return ""; }
  step(): boolean { return false; }
  pump(): void { /* stub */ }
  status(_opId: string): OpStatus { return "unknown"; }
  result(_opId: string): string | null { return null; }
  local(_id: number): ReplicaStore {
    return { value: null, ts: { num: 0, writerId: 0 } };
  }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
}

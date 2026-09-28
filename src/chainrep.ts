import { VirtualClock } from "./clock.js";
import type { LocalView, OpStatus } from "./types.js";

export type ChainRepOptions = {
  clock: VirtualClock;
  replicaCount?: number;
};

export class ChainRep {
  readonly clock: VirtualClock;
  constructor(opts: ChainRepOptions) { this.clock = opts.clock; }
  beginWrite(_value: string): string { return ""; }
  step(): boolean { return false; }
  pump(): void { /* stub */ }
  status(_opId: string): OpStatus { return "unknown"; }
  result(_opId: string): string { return ""; }
  read(): string | null { return null; }
  headId(): number | null { return null; }
  tailId(): number | null { return null; }
  chain(): number[] { return []; }
  local(_id: number): LocalView {
    return { value: null, seq: 0, online: true };
  }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
}

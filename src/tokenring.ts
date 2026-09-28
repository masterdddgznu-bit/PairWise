import { VirtualClock } from "./clock.js";
import type { NodeState } from "./types.js";

export type TokenRingOptions = {
  clock: VirtualClock;
  nodeCount?: number;
  tokenTimeout?: number;
};

export class TokenRing {
  readonly clock: VirtualClock;
  constructor(opts: TokenRingOptions) {
    this.clock = opts.clock;
  }
  request(_id: number): void { /* stub */ }
  exit(_id: number): void { /* stub */ }
  pass(): void { /* stub */ }
  tick(): void { /* stub */ }
  setOnline(_id: number, _online: boolean): void { /* stub */ }
  state(_id: number): NodeState { return "idle"; }
  hasToken(_id: number): boolean { return false; }
  tokenHolder(): number | null { return null; }
  inCs(): number | null { return null; }
  isOnline(_id: number): boolean { return true; }
}

import { VirtualClock } from "./clock.js";
import type { Rng } from "./rng.js";
import type { Bit } from "./types.js";

export type BenOrOptions = {
  clock: VirtualClock;
  rng: Rng;
  processCount?: number;
  faultBound?: number;
};

export class BenOr {
  readonly clock: VirtualClock;
  readonly rng: Rng;
  constructor(opts: BenOrOptions) {
    this.clock = opts.clock;
    this.rng = opts.rng;
  }
  reset(): void { /* stub */ }
  start(_inputs: number[]): void { /* stub */ }
  step(_id: number): boolean { return false; }
  pump(): void { /* stub */ }
  estimate(_id: number): Bit { return 0; }
  decided(_id: number): boolean { return false; }
  decision(_id: number): Bit | null { return null; }
  roundOf(_id: number): number { return 0; }
  inboxSize(_id: number): number { return 0; }
  faultBound(): number { return 0; }
  processCount(): number { return 0; }
}

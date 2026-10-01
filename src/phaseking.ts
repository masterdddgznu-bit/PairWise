import { VirtualClock } from "./clock.js";
import type { Bit } from "./types.js";

export type PhaseKingOptions = {
  clock: VirtualClock;
  processCount?: number;
  faultBound?: number;
};

export class PhaseKing {
  readonly clock: VirtualClock;
  constructor(opts: PhaseKingOptions) { this.clock = opts.clock; }
  reset(): void { /* stub */ }
  start(_inputs: number[]): void { /* stub */ }
  step(_id: number): boolean { return false; }
  pump(): void { /* stub */ }
  preference(_id: number): Bit { return 0; }
  decided(_id: number): boolean { return false; }
  decision(_id: number): Bit | null { return null; }
  phaseOf(_id: number): number { return 0; }
  inboxSize(_id: number): number { return 0; }
  kingOf(_phase: number): number { return 0; }
  faultBound(): number { return 0; }
  processCount(): number { return 0; }
}

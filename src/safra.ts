import { VirtualClock } from "./clock.js";
import type { Color } from "./types.js";

export type SafraOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class Safra {
  readonly clock: VirtualClock;
  constructor(opts: SafraOptions) { this.clock = opts.clock; }
  reset(): void { /* stub */ }
  start(): void { /* stub */ }
  send(_from: number, _to: number): void { /* stub */ }
  step(_id: number): boolean { return false; }
  pump(): void { /* stub */ }
  localDone(_id: number): void { /* stub */ }
  terminated(): boolean { return false; }
  colorOf(_id: number): Color { return "white"; }
  countOf(_id: number): number { return 0; }
  isActive(_id: number): boolean { return false; }
  hasToken(_id: number): boolean { return false; }
  nextOf(_id: number): number { return 0; }
  inboxSize(_id: number): number { return 0; }
}

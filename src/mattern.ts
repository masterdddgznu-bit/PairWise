import { VirtualClock } from "./clock.js";

export type MatternOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class Mattern {
  readonly clock: VirtualClock;
  constructor(opts: MatternOptions) { this.clock = opts.clock; }
  reset(): void { /* stub */ }
  start(): void { /* stub */ }
  send(_from: number, _to: number): void { /* stub */ }
  step(_id: number): boolean { return false; }
  pump(): void { /* stub */ }
  localDone(_id: number): void { /* stub */ }
  terminated(): boolean { return false; }
  deltaOf(_id: number): number { return 0; }
  vectorOf(_id: number): number[] { return []; }
  isActive(_id: number): boolean { return false; }
  isBlack(_id: number): boolean { return false; }
  hasProbe(_id: number): boolean { return false; }
  nextOf(_id: number): number { return 0; }
  inboxSize(_id: number): number { return 0; }
}

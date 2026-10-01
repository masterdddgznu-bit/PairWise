import { VirtualClock } from "./clock.js";

export type DSTermOptions = {
  clock: VirtualClock;
  processCount?: number;
  edges?: number[][];
  rootId?: number;
};

export class DSTerm {
  readonly clock: VirtualClock;
  constructor(opts: DSTermOptions) { this.clock = opts.clock; }
  reset(): void { /* stub */ }
  start(): void { /* stub */ }
  send(_from: number, _to: number): void { /* stub */ }
  step(_id: number): boolean { return false; }
  pump(_to?: number): void { /* stub */ }
  localDone(_id: number): void { /* stub */ }
  terminated(): boolean { return false; }
  isEngaged(_id: number): boolean { return false; }
  isActive(_id: number): boolean { return false; }
  parentOf(_id: number): number | null { return null; }
  deficitOf(_id: number): number { return 0; }
  rootId(): number { return 0; }
  neighborsOf(_id: number): number[] { return []; }
  inboxSize(_id: number): number { return 0; }
}

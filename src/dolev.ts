import { VirtualClock } from "./clock.js";

export type DolevOptions = {
  clock: VirtualClock;
  processCount?: number;
  faultBound?: number;
  sourceId?: number;
};

export class Dolev {
  readonly clock: VirtualClock;
  constructor(opts: DolevOptions) { this.clock = opts.clock; }
  reset(): void { /* stub */ }
  start(): void { /* stub */ }
  broadcast(_value: string): void { /* stub */ }
  step(_id: number): boolean { return false; }
  pump(): void { /* stub */ }
  decided(_id: number): boolean { return false; }
  decision(_id: number): string | null { return null; }
  extractedOf(_id: number): string[] { return []; }
  roundOf(_id: number): number { return 0; }
  inboxSize(_id: number): number { return 0; }
  sourceId(): number { return 0; }
  faultBound(): number { return 0; }
  processCount(): number { return 0; }
}

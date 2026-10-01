import { VirtualClock } from "./clock.js";

export type BrachaOptions = {
  clock: VirtualClock;
  processCount?: number;
  faultBound?: number;
  sourceId?: number;
};

export class Bracha {
  readonly clock: VirtualClock;
  constructor(opts: BrachaOptions) { this.clock = opts.clock; }
  reset(): void { /* stub */ }
  start(): void { /* stub */ }
  broadcast(_value: string): void { /* stub */ }
  step(_id: number): boolean { return false; }
  pump(): void { /* stub */ }
  delivered(_id: number): string | null { return null; }
  echoCount(_id: number, _value: string): number { return 0; }
  readyCount(_id: number, _value: string): number { return 0; }
  hasEchoed(_id: number): boolean { return false; }
  hasReadied(_id: number): boolean { return false; }
  inboxSize(_id: number): number { return 0; }
  sourceId(): number { return 0; }
  faultBound(): number { return 0; }
  processCount(): number { return 0; }
}

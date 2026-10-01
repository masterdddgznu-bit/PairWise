import { VirtualClock } from "./clock.js";

export type SignedMsgOptions = {
  clock: VirtualClock;
  processCount?: number;
  faultBound?: number;
  commanderId?: number;
};

export class SignedMsg {
  readonly clock: VirtualClock;
  constructor(opts: SignedMsgOptions) { this.clock = opts.clock; }
  reset(): void { /* stub */ }
  start(): void { /* stub */ }
  command(_value: string): void { /* stub */ }
  step(_id: number): boolean { return false; }
  pump(): void { /* stub */ }
  decided(_id: number): boolean { return false; }
  decision(_id: number): string | null { return null; }
  valuesOf(_id: number): string[] { return []; }
  inboxSize(_id: number): number { return 0; }
  commanderId(): number { return 0; }
  faultBound(): number { return 0; }
  processCount(): number { return 0; }
}

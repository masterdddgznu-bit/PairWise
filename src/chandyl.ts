import { VirtualClock } from "./clock.js";

export type ChandyLOptions = {
  clock: VirtualClock;
  processCount?: number;
};

export class ChandyL {
  readonly clock: VirtualClock;
  constructor(opts: ChandyLOptions) {
    this.clock = opts.clock;
  }
  setState(_id: number, _value: number): void { /* stub */ }
  getState(_id: number): number { return 0; }
  send(_from: number, _to: number, _payload: string): void { /* stub */ }
  deliver(_to: number): boolean { return false; }
  startSnapshot(_initiator: number): void { /* stub */ }
  pump(_to?: number): void { /* stub */ }
  isRecording(_id: number, _from: number): boolean { return false; }
  channelSnapshot(_id: number, _from: number): string[] { return []; }
  localDone(_id: number): boolean { return false; }
  globalDone(): boolean { return false; }
  processSnapshot(_id: number): number | null { return null; }
  queueSize(_from: number, _to: number): number { return 0; }
}

import type { CausalMessage, Missing } from "./types.js";

export class CausalBuffer {
  constructor(_n: number) {}

  receive(_to: number, _msg: CausalMessage): void {
    throw new Error("causal receive not implemented");
  }

  deliver(_to: number): CausalMessage | null {
    throw new Error("deliver not implemented");
  }

  buffered(_to: number): number {
    return 0;
  }

  deliveredClock(_to: number): number[] {
    throw new Error("deliveredClock not implemented");
  }

  missing(_to: number): Missing[] {
    throw new Error("missing not implemented");
  }

  onBroadcastLocal(_from: number, _msg: CausalMessage): void {
    throw new Error("onBroadcastLocal not implemented");
  }

  nextSeq(_from: number): number {
    throw new Error("nextSeq not implemented");
  }

  localVc(_from: number): number[] {
    throw new Error("localVc not implemented");
  }

  bumpSend(_from: number): CausalMessage {
    throw new Error("bumpSend not implemented");
  }
}

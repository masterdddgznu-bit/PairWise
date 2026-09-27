import { VirtualClock } from "./clock.js";
import type { TxStatus } from "./types.js";

export type TwopcOptions = {
  clock: VirtualClock;
  participantCount?: number;
  prepareTimeout?: number;
};

/** 2PC facade — stub. */
export class Twopc {
  readonly clock: VirtualClock;

  constructor(opts: TwopcOptions) {
    this.clock = opts.clock;
  }

  begin(): string {
    return "";
  }

  write(_txId: string, _participantId: number, _key: string, _value: string): void {
    /* stub */
  }

  prepare(_txId: string): "prepared" | "aborted" {
    return "aborted";
  }

  commit(_txId: string): void {
    /* stub */
  }

  abort(_txId: string): void {
    /* stub */
  }

  tick(): void {
    /* stub */
  }

  status(_txId: string): TxStatus {
    return "aborted";
  }

  read(_participantId: number, _key: string): string | undefined {
    return undefined;
  }

  crashCoordinator(): void {
    /* stub */
  }

  recoverCoordinator(): void {
    /* stub */
  }

  journalEntries(): unknown[] {
    return [];
  }
}

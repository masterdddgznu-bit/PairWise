import { VirtualClock } from "./clock.js";
import { InvalidConfigError, UnknownTxnError } from "./errors.js";
import type { LocalPhase, TxnPhase, TxnPrepOptions } from "./types.js";

export class TxnPrep {
  readonly clock: VirtualClock;

  constructor(opts: TxnPrepOptions) {
    if (!opts.clock) throw new InvalidConfigError("clock");
    this.clock = opts.clock;
  }

  begin(_txnId: string): void {}
  enlist(_txnId: string, _participantId: string, _keys: string[]): void {}
  prepare(_txnId: string): "prepared" | "aborted" {
    return "aborted";
  }
  commit(_txnId: string): "committed" | "aborted" | "unknown" {
    return "unknown";
  }
  abort(_txnId: string): void {}
  drive(): string[] {
    return [];
  }
  status(_txnId: string): TxnPhase {
    throw new UnknownTxnError("x");
  }
  phaseOf(txnId: string): TxnPhase {
    return this.status(txnId);
  }
  participantsOf(_txnId: string): string[] {
    return [];
  }
  setParticipantHang(_participantId: string, _hang: boolean): void {}
  locksOf(_participantId: string): string[] {
    return [];
  }
  localPhase(_participantId: string, _txnId: string): LocalPhase {
    return "none";
  }
  recover(_txnId: string): "committed" | "aborted" | "unknown" {
    return "unknown";
  }
  exportState(): string {
    return "{}";
  }
  importState(_json: string): void {}
}

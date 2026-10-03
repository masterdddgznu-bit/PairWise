import { VirtualClock } from "./clock.js";
import { InvalidConfigError, UnknownTxnError } from "./errors.js";
import type { EpochMVCCOptions } from "./types.js";

export class EpochMVCC {
  readonly clock: VirtualClock;

  constructor(opts: EpochMVCCOptions) {
    if (!opts.clock) throw new InvalidConfigError("clock");
    this.clock = opts.clock;
  }

  epoch(): number {
    return 0;
  }

  get(_key: string): string | undefined {
    return undefined;
  }

  getAt(_epoch: number, _key: string): string | undefined {
    return undefined;
  }

  pin(_pinId: string): number {
    return 0;
  }

  unpin(_pinId: string): boolean {
    return false;
  }

  getPinned(_pinId: string, _key: string): string | undefined {
    return undefined;
  }

  pinEpoch(_pinId: string): number {
    return 0;
  }

  pinnedIds(): string[] {
    return [];
  }

  begin(_txnId: string): void {}

  write(_txnId: string, _key: string, _value: string): void {
    throw new UnknownTxnError("x");
  }

  delete(_txnId: string, _key: string): void {
    throw new UnknownTxnError("x");
  }

  read(_txnId: string, _key: string): string | undefined {
    return undefined;
  }

  commit(_txnId: string): "ok" | "conflict" {
    return "conflict";
  }

  abort(_txnId: string): boolean {
    return false;
  }

  gc(): number {
    return 0;
  }

  drive(): string[] {
    return [];
  }

  versionCount(_key: string): number {
    return 0;
  }

  hasTxn(_txnId: string): boolean {
    return false;
  }
}

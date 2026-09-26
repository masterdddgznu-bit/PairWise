import { VirtualClock } from "./clock.js";
import type { AppendResult, RecoverResult } from "./types.js";

export type WalOptions = {
  clock: VirtualClock;
  segmentBytes?: number;
  groupCommitDelay?: number;
};

/** Segmented WAL — stub does not persist. */
export class Wal {
  readonly clock: VirtualClock;

  constructor(opts: WalOptions) {
    this.clock = opts.clock;
  }

  append(_payload: string): AppendResult {
    return { lsn: 0 };
  }

  flush(): void {
    /* stub */
  }

  tick(): void {
    /* stub */
  }

  checkpoint(): number {
    return 0;
  }

  crash(): void {
    /* stub */
  }

  recover(): RecoverResult {
    return { records: [], lastLsn: 0, checkpointLsn: 0 };
  }

  durableLsn(): number {
    return 0;
  }

  bufferedCount(): number {
    return 0;
  }

  segmentIds(): number[] {
    return [];
  }

  /** Allows tests to inject durable lines; stub ignores. */
  injectRawLine(_line: string): void {
    /* stub */
  }
}

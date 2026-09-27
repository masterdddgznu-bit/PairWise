import { VirtualClock } from "./clock.js";
import { EpochTracker } from "./epoch.js";
import { ThreadTable } from "./thread_table.js";
import { RetireList } from "./retire_list.js";
import { collectReclaimable, isUnblocked } from "./reclaimer.js";

export type EpochGcOptions = {
  clock: VirtualClock;
  threadCount?: number;
  reclaimDelay?: number;
};

/** Epoch-based reclaimer facade. */
export class EpochGc {
  readonly clock: VirtualClock;
  private readonly reclaimDelay: number;
  private readonly threads: ThreadTable;
  private readonly epochs = new EpochTracker();
  private readonly retired = new RetireList();

  constructor(opts: EpochGcOptions) {
    this.clock = opts.clock;
    this.reclaimDelay = opts.reclaimDelay ?? 0;
    this.threads = new ThreadTable(opts.threadCount ?? 3);
  }

  pin(threadId: number): number {
    const epoch = this.epochs.current();
    this.threads.pin(threadId, epoch);
    return epoch;
  }

  unpin(threadId: number): boolean {
    return this.threads.unpin(threadId);
  }

  currentEpoch(): number {
    return this.epochs.current();
  }

  minPinned(): number | null {
    return this.epochs.minPinned(this.threads);
  }

  bump(): number {
    return this.epochs.bump();
  }

  retire(id: string): void {
    this.retired.add(id, this.epochs.current());
    const record = this.retired.records()[this.retired.size() - 1];
    if (isUnblocked(record, this.threads)) {
      record.eligibleAt = this.clock.now();
    }
  }

  reclaim(): string[] {
    const ready = collectReclaimable(
      this.retired.records(),
      this.threads,
      this.clock.now(),
      this.reclaimDelay,
    );
    this.retired.removeIds(ready);
    return ready;
  }

  tick(): string[] {
    this.clock.advance(1);
    return this.reclaim();
  }

  unregister(threadId: number): void {
    this.threads.unregister(threadId);
  }

  pendingCount(): number {
    return this.retired.size();
  }
}

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
  private readonly threads: ThreadTable;
  private readonly epoch = new EpochTracker();
  private readonly retired = new RetireList();
  private readonly reclaimDelay: number;

  constructor(opts: EpochGcOptions) {
    this.clock = opts.clock;
    this.threads = new ThreadTable(opts.threadCount ?? 3);
    this.reclaimDelay = opts.reclaimDelay ?? 0;
  }

  pin(threadId: number): number {
    const epoch = this.epoch.current();
    this.threads.pin(threadId, epoch);
    return epoch;
  }

  unpin(threadId: number): boolean {
    return this.threads.unpin(threadId);
  }

  currentEpoch(): number {
    return this.epoch.current();
  }

  minPinned(): number | null {
    return this.epoch.minPinned(this.threads);
  }

  bump(): number {
    return this.epoch.bump();
  }

  retire(id: string): void {
    const epoch = this.epoch.current();
    const eligibleAt = isUnblocked({ id, epoch, eligibleAt: null }, this.threads)
      ? this.clock.now()
      : null;
    this.retired.add(id, epoch, eligibleAt);
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
